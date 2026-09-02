import { CONFIG } from './config.js';
import { Tracker } from './tracking.js';
import { HandPointers } from './hands.js';
import { buildPortrait } from './portrait.js';
import { Ink } from './ink.js';
import { Deform } from './deform.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';

const el = (id) => document.getElementById(id);
const video = el('video');
const preview = el('preview');
const gl = el('gl');
const hud = el('hud');
const pctx = preview.getContext('2d');
const hctx = hud.getContext('2d');

const tracker = new Tracker();
const hands = new HandPointers();
const ui = new UI();
let ink = null;
let deform = null;
let renderer = null;
let portrait = null;

const state = {
  phase: 'intro',        // intro | capture | break | result
  tool: 'ink',
  colorIndex: 0,
  sizeIndex: 1,
  stableFrames: 0,
  countdownUntil: 0,
};

const history = [];
const uiCaptured = new Set();
const strokeFrom = new Map();
let hovered = null;
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
    preview.width = gl.width = hud.width = W;
    preview.height = gl.height = hud.height = H;

    renderer = new Renderer(gl);
    ink = new Ink(Math.round(W * CONFIG.inkScale), Math.round(H * CONFIG.inkScale));
    deform = new Deform();
    ui.layout(W, H);
    layout();

    window.breakToCreate = { CONFIG, tracker, ink, deform, renderer, ui, state, shoot, finish };

    setPhase('capture');
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
  el('capture-ui').classList.toggle('hidden', phase !== 'capture');
  preview.classList.toggle('hidden', phase !== 'capture');
  gl.classList.toggle('hidden', phase !== 'break' && phase !== 'result');
  hud.classList.toggle('hidden', phase !== 'break');
  el('shell').classList.toggle('hidden', phase === 'intro' || phase === 'loading' || phase === 'error');
}

// ---------------------------------------------------------------- capture

function armShutter() {
  if (state.countdownUntil) return;
  state.countdownUntil = performance.now() + CONFIG.countdownSeconds * 1000;
}

function shoot() {
  state.countdownUntil = 0;
  state.stableFrames = 0;
  el('count').textContent = '';

  const faceLandmarks = tracker.result.face;
  portrait = buildPortrait(video, W, H, tracker, faceLandmarks);
  renderer.setPortrait(portrait.canvas);
  hud.width = W;
  hud.height = H;
  ui.layout(W, H);

  ink.clear();
  deform.clear();
  history.length = 0;
  renderer.updateInk(ink.canvas);
  renderer.updateDisp(deform.pack(), deform.w, deform.h);
  renderer.reveal = 0;

  setPhase('break');
  layout();
  el('flash').classList.add('fire');
  setTimeout(() => el('flash').classList.remove('fire'), 420);
}

// ---------------------------------------------------------------- break

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
  if (!portrait) return;
  snapshot();
  ink.clear();
  deform.clear();
}

function handlePointer(p) {
  if (p.pressed) {
    const hit = ui.hitTest(p.x, p.y);
    if (hit) {
      uiCaptured.add(p.id);
      const action = ui.activate(hit, state);
      if (action === 'undo') undo();
      if (action === 'reset') reset();
      if (action === 'done') finish();
      return;
    }
    snapshot();
    strokeFrom.set(p.id, { x: p.x, y: p.y });

    if (state.tool === 'ink') {
      ink.splat(p.x * CONFIG.inkScale, p.y * CONFIG.inkScale, colorHex(),
                brush() * CONFIG.inkScale, { x: p.vx, y: p.vy });
    } else if (state.tool === 'pour') {
      ink.pour(p.x * CONFIG.inkScale, p.y * CONFIG.inkScale, colorHex(), brush() * 1.5 * CONFIG.inkScale);
    }
  }

  if (p.pinching && !uiCaptured.has(p.id)) {
    const from = strokeFrom.get(p.id) ?? { x: p.x, y: p.y };
    if (state.tool === 'paint') {
      ink.strokeTo(
        { x: from.x * CONFIG.inkScale, y: from.y * CONFIG.inkScale },
        { x: p.x * CONFIG.inkScale, y: p.y * CONFIG.inkScale },
        colorHex(), brush() * CONFIG.inkScale,
      );
    } else if (state.tool === 'break') {
      const dx = (p.x - from.x) / W;
      const dy = (p.y - from.y) / H;
      if (dx || dy) {
        deform.push(p.x / W, p.y / H, dx, dy, CONFIG.deformRadius * (brush() / CONFIG.brushSizes[1]));
      }
    }
    strokeFrom.set(p.id, { x: p.x, y: p.y });
  }

  if (p.released) {
    uiCaptured.delete(p.id);
    strokeFrom.delete(p.id);
  }
}

function finish() {
  if (state.phase !== 'break') return;
  setPhase('result');
  el('before').src = portrait.canvas.toDataURL('image/png');
  renderer.render();
  el('after').src = gl.toDataURL('image/png');
}

function again() {
  portrait = null;
  setPhase('capture');
}

function save() {
  renderer.render();
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
  if (video.readyState < 2) return;

  if (state.phase === 'capture') {
    const { face } = tracker.detect(video, true, false);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, W, H);
    pctx.save();
    pctx.translate(W, 0);
    pctx.scale(-1, 1);
    pctx.filter = 'grayscale(1) contrast(1.2)';
    pctx.drawImage(video, 0, 0, W, H);
    pctx.restore();
    pctx.filter = 'none';

    state.stableFrames = face ? state.stableFrames + 1 : 0;
    if (state.stableFrames >= CONFIG.autoShutterFrames) armShutter();

    if (state.countdownUntil) {
      const left = state.countdownUntil - now;
      el('count').textContent = left > 0 ? String(Math.ceil(left / 1000)) : '';
      if (left <= 0) shoot();
    }
    el('capture-hint').textContent = state.countdownUntil ? ''
      : face ? '動かないで…' : '顔をカメラに写してください';
  } else if (state.phase === 'break') {
    const { hands: detected } = tracker.detect(video, false, true);
    const pointers = hands.update(detected, W, H);
    pointers.push(...mouse.drain());

    hovered = null;
    // One cursor per input, even when a pointer delivered several samples.
    const cursors = new Map();
    for (const p of pointers) {
      hovered = ui.hitTest(p.x, p.y) ?? hovered;
      handlePointer(p);
      cursors.set(p.id, p);
    }

    ink.update(dt);
    if (ink.dirty) { renderer.updateInk(ink.canvas); ink.dirty = false; }
    if (deform.dirty) renderer.updateDisp(deform.pack(), deform.w, deform.h);
    renderer.reveal = Math.min(1, renderer.reveal + dt * 2.2);
    renderer.render();
    ui.draw(hctx, state, hovered, [...cursors.values()]);
  }

  frames++;
  if (now - fpsAt > 500) {
    el('fps').textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`;
    frames = 0;
    fpsAt = now;
  }
}

// ---------------------------------------------------------------- input

function layout() {
  if (!W) return;
  const scale = Math.min(window.innerWidth / W, (window.innerHeight - 92) / H);
  for (const c of [preview, gl, hud]) {
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

// Pointer events are queued rather than sampled, so a gesture that starts and
// ends between two frames still delivers every step of its motion. Sampling
// only the latest position drops whole strokes whenever the loop runs slow.
const mouse = {
  over: false,
  down: false,
  queue: [],
  last: null,

  push(x, y, down) {
    if (this.queue.length > 64) this.queue.shift();
    this.queue.push({ x, y, down });
  },

  drain() {
    if (this.queue.length === 0) {
      // Nothing moved, but a hovering pointer still needs a cursor.
      return this.last && (this.over || this.down)
        ? [{ id: 'mouse', x: this.last.x, y: this.last.y, vx: 0, vy: 0,
             pinching: this.last.down, pressed: false, released: false }]
        : [];
    }

    const out = [];
    for (const e of this.queue) {
      const prev = this.last ?? { x: e.x, y: e.y, down: false };
      out.push({
        id: 'mouse',
        x: e.x, y: e.y,
        vx: e.x - prev.x, vy: e.y - prev.y,
        pinching: e.down,
        pressed: e.down && !prev.down,
        released: !e.down && prev.down,
      });
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
  if (state.phase === 'capture' && (key === ' ' || key === 'enter')) { armShutter(); e.preventDefault(); return; }
  if (state.phase === 'result') {
    if (key === 's') save();
    else if (key === 'enter' || key === 'r') again();
    else return;
    e.preventDefault();
    return;
  }
  if (state.phase !== 'break') return;

  if (key >= '1' && key <= String(Math.min(9, CONFIG.palette.length))) state.colorIndex = Number(key) - 1;
  else if (key === 'b') state.tool = 'break';
  else if (key === 'i') state.tool = 'ink';
  else if (key === 'p') state.tool = 'paint';
  else if (key === 'o') state.tool = 'pour';
  else if (key === '[') state.sizeIndex = Math.max(0, state.sizeIndex - 1);
  else if (key === ']') state.sizeIndex = Math.min(CONFIG.brushSizes.length - 1, state.sizeIndex + 1);
  else if (key === 'z') undo();
  else if (key === 'r') reset();
  else if (key === 'enter') finish();
  else if (key === 'h') { ui.visible = !ui.visible; el('hud-bar').classList.toggle('hidden', !ui.visible); }
  else if (key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else return;
  e.preventDefault();
});

window.addEventListener('resize', layout);
el('start').addEventListener('click', start);
el('retry').addEventListener('click', start);
el('shutter').addEventListener('click', armShutter);
el('save').addEventListener('click', save);
el('again').addEventListener('click', again);
