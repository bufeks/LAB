import { CONFIG } from './config.js';

// Turns one captured camera frame into the "bust": the visitor cut out of
// their background, drained of colour and set on paper, ready to be broken.
export function buildPortrait(video, width, height, tracker, faceLandmarks) {
  const frame = canvasOf(width, height);
  const fctx = frame.getContext('2d');
  fctx.translate(width, 0);
  fctx.scale(-1, 1);
  fctx.drawImage(video, 0, 0, width, height);
  fctx.setTransform(1, 0, 0, 1, 0, 0);

  const centre = faceCentre(faceLandmarks);
  const mask = tracker.segment(frame, centre);

  const cut = canvasOf(width, height);
  const cctx = cut.getContext('2d');
  cctx.filter = 'grayscale(1) contrast(1.45) brightness(1.06)';
  cctx.drawImage(frame, 0, 0);
  cctx.filter = 'none';
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(mask ? maskCanvas(mask) : ovalMask(centre, width, height), 0, 0, width, height);
  cctx.globalCompositeOperation = 'source-over';

  const out = canvasOf(width, height);
  const ctx = out.getContext('2d');
  paper(ctx, width, height);

  // A soft cast shadow lifts the bust off the paper.
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.filter = 'blur(18px) brightness(0)';
  ctx.drawImage(cut, 6, 14);
  ctx.restore();

  ctx.drawImage(cut, 0, 0);
  edges(ctx, cut, width, height);
  vignette(ctx, width, height);

  return { canvas: out, centre };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function faceCentre(landmarks) {
  if (!landmarks?.length) return { x: 0.5, y: 0.42 };
  // Landmark 1 is the nose tip; it is the safest "definitely the person" probe.
  const p = landmarks[1] ?? landmarks[0];
  return { x: p.x, y: p.y };
}

// The category mask becomes an alpha channel. Upscaling it to frame size
// feathers the silhouette, which is what keeps the cut-out from looking
// like a sticker.
function maskCanvas({ data, width, height, personLabel }) {
  const c = canvasOf(width, height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    img.data[i * 4 + 3] = data[i] === personLabel ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function ovalMask(centre, w, h) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const cx = centre.x * w;
  const cy = centre.y * h;
  const g = ctx.createRadialGradient(cx, cy + h * 0.06, h * 0.12, cx, cy + h * 0.06, h * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.65, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function paper(ctx, w, h) {
  ctx.fillStyle = CONFIG.paper;
  ctx.fillRect(0, 0, w, h);
  // Static fibre grain, baked in once so it never shimmers between frames.
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let seed = 20260902;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed >> 16) & 255) / 255 - 0.5;
    d[i] += n * 13;
    d[i + 1] += n * 13;
    d[i + 2] += n * 12;
  }
  ctx.putImageData(img, 0, 0);
}

// A cheap difference-of-blur edge pass, multiplied back over the bust. It is
// what makes the portrait read as drawn rather than photographed.
function edges(ctx, cut, w, h) {
  const s = 0.5;
  const a = canvasOf(w * s, h * s);
  const actx = a.getContext('2d');
  actx.filter = 'grayscale(1)';
  actx.drawImage(cut, 0, 0, w * s, h * s);

  const b = canvasOf(w * s, h * s);
  const bctx = b.getContext('2d');
  bctx.filter = 'blur(2px)';
  bctx.drawImage(a, 0, 0);

  actx.filter = 'none';
  actx.globalCompositeOperation = 'difference';
  actx.drawImage(b, 0, 0);
  actx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.85;
  ctx.filter = 'invert(1) contrast(2.4) brightness(1.15)';
  ctx.drawImage(a, 0, 0, w, h);
  ctx.restore();
}

function vignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(30,24,18,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
