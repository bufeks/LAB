import { CONFIG, POSES } from './config.js';
import { Tracker } from './tracking.js';
import { FaceFrame } from './face.js';
import { FaceDepth } from './depth.js';
import { Gestures } from './gestures.js';
import { Ink } from './ink.js';
import { Deform } from './deform.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const el = (id) => document.getElementById(id);
const video = el('video');
const gl = el('gl');
const hud = el('hud');
const hctx = hud.getContext('2d');

const tracker = new Tracker();
const gestures = new Gestures();
const face = new FaceFrame();
const depth = new FaceDepth();
const ui = new UI();
let ink = null;
let deform = null;
let renderer = null;

const state = {
  phase: 'intro',      // intro | loading | error | live | result
  ready: false,        // the bust has been generated
  colorIndex: 0,
  sizeIndex: 1,
  mouseTool: 'point',
};

const history = [];
const strokeFrom = new Map();
const cooldown = new Map();
let beforeImage = null;
let scanStart = 0;
let stableFrames = 0;
let W = 0;
let H = 0;
let last = 0;
let frames = 0;
let fpsAt = 0;

const colorHex = () => CONFIG.palette[state.colorIndex].hex;
const brush = () => CONFIG.brushSizes[state.sizeIndex];

// ---------------------------------------------------------------- boot

async function start() {
  setPhase('loading');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CONFIG.camera.width },
        height: { ideal: CONFIG.camera.height },
        facingMode: CONFIG.camera.facingMode,
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadeddata', r, { once: true })));

    await tracker.init();

    W = video.videoWidth;
    H = video.videoHeight;
    hud.width = W;
    hud.height = H;

    renderer = new Renderer(gl);
    renderer.resize(W, H);
    ink = new Ink(CONFIG.inkSize, CONFIG.inkSize);
    deform = new Deform();
    ui.layout(W, H);
    layout();

    window.breakToCreate = { CONFIG, tracker, face, depth, gestures, ink, deform, renderer, ui, state, finish, generate };

    setPhase('live');
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    el('error-msg').textContent = describe(err);
    setPhase('error');
  }
}

function describe(err) {
  if (err?.name === 'NotAllowedError') return 'カメラの使用が許可されませんでした。ブラウザの設定で許可してから再試行してください。';
  if (err?.name === 'NotFoundError') return 'カメラが見つかりませんでした。接続を確認してください。';
  if (/WebGL2/.test(String(err?.message))) return 'この体験には WebGL2 が必要です。対応ブラウザで開いてください。';
  if (/fetch|network|Failed to load/i.test(String(err?.message ?? err))) {
    return 'モデルの読み込みに失敗しました。ネットワークを確認するか、README の手順でモデルをローカルに置いてください。';
  }
  return String(err?.message ?? err);
}

function setPhase(phase) {
  state.phase = phase;
  for (const id of ['intro', 'loading', 'error', 'result']) {
    el(id).classList.toggle('hidden', id !== phase);
  }
  el('shell').classList.toggle('hidden', phase === 'intro' || phase === 'loading' || phase === 'error');
  el('guide').classList.toggle('hidden', phase !== 'live');
}

// The bust is "generated": a sweep down the frame, then the untouched
// portrait is kept as the OLD SELF for the comparison at the end.
function generate() {
  scanStart = performance.now();
  state.ready = false;
  ink.clear();
  deform.clear();
  history.length = 0;
}

// ---------------------------------------------------------------- gestures

function snapshot() {
  history.push({ ink: ink.snapshot(), deform: deform.snapshot() });
  if (history.length > CONFIG.historyLimit) history.shift();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  ink.restore(prev.ink);
  deform.restore(prev.deform);
}

function reset() {
  snapshot();
  ink.clear();
  deform.clear();
}

function ready(now, id, key, ms) {
  const at = cooldown.get(`${id}:${key}`) ?? 0;
  if (now - at < ms) return false;
  cooldown.set(`${id}:${key}`, now);
  return true;
}

function act(hand, now) {
  if (!face.present || !state.ready) return;
  if (!hand.armed) { strokeFrom.delete(hand.id); return; }

  const inkPt = face.toInk(hand.x, hand.y, W, H);
  const faceUv = face.toFaceUv(hand.x, hand.y, W, H);
  const from = strokeFrom.get(hand.id) ?? inkPt;
  if (hand.entered) snapshot();

  switch (hand.pose) {
    case 'point':
      // A still finger leaves nothing. Paint is laid down by moving it.
      if (hand.moving) ink.strokeTo(from, inkPt, colorHex(), brush());
      break;

    case 'pinch': {
      // The hand moved this far across the head, in eye-distances. The first
      // frame of a grip has no meaningful travel yet.
      const d = hand.entered ? { x: 0, y: 0 } : face.deltaToFace(hand.vx, hand.vy, H);
      if (d.x || d.y) {
        deform.push(faceUv.x, faceUv.y,
          d.x * CONFIG.deformGain, d.y * CONFIG.deformGain,
          CONFIG.deformRadius * (brush() / CONFIG.brushSizes[1]));
      }
      break;
    }

    case 'fist':
      // One swing of the fist, one blot, landing just ahead of the knuckles.
      if (!hand.struck) break;
      if (!ready(now, hand.id, 'fist', CONFIG.gesture.cooldown.fist)) break;
      snapshot();
      {
        const lead = CONFIG.gesture.lead;
        const at = face.toInk(hand.rawX + hand.vx * lead, hand.rawY + hand.vy * lead, W, H);
        const next = face.toInk(hand.rawX + hand.vx * (lead + 1), hand.rawY + hand.vy * (lead + 1), W, H);
        ink.splat(at.x, at.y, colorHex(), brush(), { x: next.x - at.x, y: next.y - at.y });
      }
      break;

    case 'open':
      // An open hand has to be slapped forward to empty the bucket, and it
      // lands under the palm, not behind it.
      if (!hand.struck) break;
      if (!ready(now, hand.id, 'open', CONFIG.gesture.cooldown.open)) break;
      snapshot();
      {
        const at = face.toInk(hand.rawX, hand.rawY, W, H);
        ink.pour(at.x, at.y, colorHex(), brush() * 1.4);
      }
      break;

    default:
      strokeFrom.delete(hand.id);
      return;
  }

  strokeFrom.set(hand.id, inkPt);
}

function finish() {
  if (state.phase !== 'live') return;
  setPhase('result');
  el('before').src = beforeImage ?? gl.toDataURL('image/png');
  el('after').src = gl.toDataURL('image/png');
}

function again() {
  setPhase('live');
  generate();
}

function save() {
  gl.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-self-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

// ---------------------------------------------------------------- loop

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000) || 0;
  last = now;
  if (video.readyState < 2 || state.phase !== 'live') return;

  const detected = tracker.detect(video);
  face.update(detected.face, W, H, now);

  renderer.updateVideo(video);
  depth.update(face);
  if (depth.ready) renderer.updateDepth(depth.pack(), depth.size);
  if (detected.mask) renderer.updateMask(detected.mask.data, detected.mask.width, detected.mask.height);

  // Hold still once, and the bust is generated.
  if (!state.ready && !scanStart) {
    stableFrames = face.present ? stableFrames + 1 : 0;
    if (stableFrames > 20) generate();
  }

  const hands = gestures.read(detected.hands, W, H);

  // A hand resting on a control is choosing, not painting.
  const pointers = hands.map((h) => ({ id: h.id, x: h.x, y: h.y }));
  if (mouse.over) pointers.push({ id: 'mouse', x: mouse.x, y: mouse.y, instant: mouse.clicked() });
  for (const action of ui.update(pointers, now, state)) {
    if (action === 'undo') undo();
    if (action === 'reset') reset();
    if (action === 'done') finish();
  }

  for (const hand of hands) {
    if (ui.hitTest(hand.x, hand.y)) { strokeFrom.delete(hand.id); continue; }
    act(hand, now);
  }
  for (const m of mouse.drain()) {
    if (ui.hitTest(m.x, m.y)) continue;
    act(m, now);
  }

  ink.update(dt);
  if (ink.dirty) { renderer.updateInk(ink.canvas); ink.dirty = false; }
  if (deform.dirty) renderer.updateDisp(deform.pack(), deform.size);

  // The generating sweep, and the still it leaves behind.
  if (scanStart) {
    const t = (now - scanStart) / 1300;
    renderer.scan = Math.min(1, t);
    if (t >= 1) {
      renderer.scan = -1;
      scanStart = 0;
      state.ready = true;
      renderer.render(face);
      beforeImage = gl.toDataURL('image/png');
    }
  }

  renderer.render(face);
  ui.draw(hctx, state, hands, now);
  legend(hands);

  frames++;
  if (now - fpsAt > 500) {
    el('fps').textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`;
    frames = 0;
    fpsAt = now;
  }
  el('hint').textContent = !face.present ? '顔をカメラに写してください'
    : !state.ready ? '生成中…'
    : hands.length === 0 ? '手をカメラに写してください' : '';
}

function legend(hands) {
  const live = new Set(hands.filter((h) => h.armed).map((h) => h.pose));
  for (const pose of Object.keys(POSES)) {
    el(`g-${pose}`)?.classList.toggle('on', live.has(pose));
  }
}

// ---------------------------------------------------------------- input

function layout() {
  if (!W) return;
  const scale = Math.min(window.innerWidth / W, (window.innerHeight - 150) / H);
  for (const c of [gl, hud]) {
    c.style.width = `${Math.floor(W * scale)}px`;
    c.style.height = `${Math.floor(H * scale)}px`;
  }
}

function toCanvas(clientX, clientY) {
  const rect = hud.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H,
  };
}

// Desktop fallback. Gestures are the real input; the mouse borrows whichever
// pose is selected with the keyboard, which is also what makes the piece
// testable without a person in front of the camera.
const mouse = {
  over: false, down: false, x: 0, y: 0, queue: [], last: null, click: false, fast: false,

  clicked() {
    const was = this.click;
    this.click = false;
    return was;
  },

  push(x, y, down) {
    if (this.queue.length > 64) this.queue.shift();
    this.queue.push({ x, y, down });
    this.x = x;
    this.y = y;
  },

  drain() {
    const out = [];
    for (const e of this.queue) {
      const prev = this.last ?? { x: e.x, y: e.y, down: false };
      if (e.down) {
        const speed = Math.hypot(e.x - prev.x, e.y - prev.y);
        const fast = speed > (CONFIG.gesture.speed[state.mouseTool] ?? Infinity);
        out.push({
          id: 'mouse',
          pose: state.mouseTool,
          entered: !prev.down,
          armed: true,
          moving: fast,
          struck: fast && !this.fast,
          x: e.x, y: e.y,
          vx: e.x - prev.x, vy: e.y - prev.y,
          speed,
          span: 100,
          points: null,
        });
        this.fast = fast;
      } else if (prev.down) {
        this.fast = false;
        out.push({ id: 'mouse', pose: 'idle', entered: true, armed: false, moving: false,
                   struck: false, x: e.x, y: e.y, vx: 0, vy: 0, speed: 0, span: 100, points: null });
      }
      this.last = e;
    }
    this.queue.length = 0;
    return out;
  },
};

hud.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  e.preventDefault();
  const p = toCanvas(e.clientX, e.clientY);
  mouse.over = true;
  mouse.down = true;
  mouse.click = true;
  mouse.push(p.x, p.y, true);
  hud.setPointerCapture(e.pointerId);
});

hud.addEventListener('pointermove', (e) => {
  const p = toCanvas(e.clientX, e.clientY);
  mouse.over = true;
  mouse.push(p.x, p.y, mouse.down);
});

hud.addEventListener('pointerup', (e) => {
  if (!mouse.down) return;
  const p = toCanvas(e.clientX, e.clientY);
  mouse.down = false;
  mouse.push(p.x, p.y, false);
});

hud.addEventListener('pointerleave', () => {
  mouse.over = false;
  if (mouse.down && mouse.last) {
    mouse.down = false;
    mouse.push(mouse.last.x, mouse.last.y, false);
  }
});

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (state.phase === 'result') {
    if (key === 's') save();
    else if (key === 'enter' || key === 'r') again();
    else return;
    e.preventDefault();
    return;
  }
  if (state.phase !== 'live') return;

  if (key >= '1' && key <= String(Math.min(9, CONFIG.palette.length))) state.colorIndex = Number(key) - 1;
  else if (key === 'i') state.mouseTool = 'fist';
  else if (key === 'p') state.mouseTool = 'point';
  else if (key === 'o') state.mouseTool = 'open';
  else if (key === 'b') state.mouseTool = 'pinch';
  else if (key === '[') state.sizeIndex = Math.max(0, state.sizeIndex - 1);
  else if (key === ']') state.sizeIndex = Math.min(CONFIG.brushSizes.length - 1, state.sizeIndex + 1);
  else if (key === 'z') undo();
  else if (key === 'r') reset();
  else if (key === 'g') generate();
  else if (key === 'enter') finish();
  else if (key === 'h') {
    ui.visible = !ui.visible;
    el('guide').classList.toggle('faded', !ui.visible);
    el('hud-bar').classList.toggle('faded', !ui.visible);
  } else if (key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else return;
  e.preventDefault();
});

window.addEventListener('resize', layout);
el('start').addEventListener('click', start);
el('retry').addEventListener('click', start);
el('save').addEventListener('click', save);
el('again').addEventListener('click', again);
