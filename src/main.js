import { CONFIG } from './config.js';
import { Tracker } from './tracking.js';
import { FaceModel } from './face.js';
import { Painter } from './painter.js';
import { HandPointers } from './hands.js';
import { UI } from './ui.js';

const video = document.getElementById('video');
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const bootEl = document.getElementById('boot');
const errorEl = document.getElementById('error');
const errorMsg = document.getElementById('error-msg');
const hudEl = document.getElementById('hud');
const fpsEl = document.getElementById('fps');
const hintEl = document.getElementById('hint');

const tracker = new Tracker();
const hands = new HandPointers();
const ui = new UI();
let face = null;
let painter = null;

const state = {
  colorIndex: 0,
  sizeIndex: 1,
  style: 'solid',
  erase: false,
  symmetry: false,
};

const uiCaptured = new Set();
let hovered = null;
let frames = 0;
let fpsAt = 0;

function brushOptions() {
  return {
    color: CONFIG.palette[state.colorIndex],
    size: CONFIG.brushSizes[state.sizeIndex],
    style: state.style,
    erase: state.erase,
    symmetry: state.symmetry,
  };
}

async function start() {
  bootEl.classList.add('hidden');
  errorEl.classList.add('hidden');
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
    await new Promise((resolve) => {
      if (video.videoWidth) resolve();
      else video.addEventListener('loadeddata', resolve, { once: true });
    });

    await tracker.init();

    face = new FaceModel(tracker.faceOvalRing);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    painter = new Painter(canvas.width, canvas.height);
    ui.layout(canvas.width, canvas.height);
    layout();

    // Handle for tuning from the console while the piece is running.
    window.facePaint = { CONFIG, tracker, face, painter, ui, state };

    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    fail(describe(err));
  }
}

function describe(err) {
  if (err?.name === 'NotAllowedError') {
    return 'カメラの使用が許可されませんでした。ブラウザの設定で許可してから再試行してください。';
  }
  if (err?.name === 'NotFoundError') {
    return 'カメラが見つかりませんでした。接続を確認してください。';
  }
  if (String(err?.message ?? err).match(/fetch|network|Failed to load/i)) {
    return 'モデルの読み込みに失敗しました。ネットワークを確認するか、README の手順でモデルをローカルに置いてください。';
  }
  return String(err?.message ?? err);
}

function fail(message) {
  errorMsg.textContent = message;
  errorEl.classList.remove('hidden');
}

// Fit the canvas element inside the window while preserving the camera's
// aspect ratio, so screen coordinates map linearly onto canvas pixels.
function layout() {
  if (!canvas.width) return;
  const margin = 0;
  const scale = Math.min(
    (window.innerWidth - margin) / canvas.width,
    (window.innerHeight - margin) / canvas.height,
  );
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

function toCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

function handlePointer(p) {
  if (p.pressed) {
    const hit = ui.hitTest(p.x, p.y);
    if (hit) {
      uiCaptured.add(p.id);
      const action = ui.activate(hit, state);
      if (action === 'undo') painter.undo();
      if (action === 'clear') painter.clear();
      return;
    }
    if (face.present) painter.begin(p.id, face, brushOptions());
  }

  if (p.pinching && !uiCaptured.has(p.id)) {
    if (!painter.isPainting(p.id) && face.present) {
      // The face may have appeared after the pinch started.
      painter.begin(p.id, face, brushOptions());
    }
    painter.extend(p.id, p.x, p.y, face);
  }

  if (p.released) {
    painter.end(p.id);
    uiCaptured.delete(p.id);
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;

  const { face: faceLandmarks, hands: handResults } = tracker.detect(video);
  face.update(faceLandmarks, canvas.width, canvas.height, now);

  const pointers = hands.update(handResults, canvas.width, canvas.height);
  if (mouse.active) pointers.push(mouse.take());

  hovered = null;
  for (const p of pointers) {
    if (!hovered) hovered = ui.hitTest(p.x, p.y);
    handlePointer(p);
  }

  if (CONFIG.idleClearMs > 0 && !painter.isEmpty
      && face.idleFor(now) > CONFIG.idleClearMs) {
    painter.clear();
  }

  painter.render(face);
  draw(pointers);

  frames++;
  if (now - fpsAt > 500) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`;
    frames = 0;
    fpsAt = now;
  }
  hintEl.textContent = !face.present
    ? '顔をカメラに写してください'
    : handResults.length === 0
      ? '手を写して、親指と人差し指をつまむとペイントできます'
      : '';
}

function draw(pointers) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (face.present) {
    ctx.save();
    face.tracePath(ctx);
    ctx.clip();
    ctx.drawImage(painter.canvas, 0, 0);
    ctx.restore();
  }

  for (const p of pointers) {
    const size = CONFIG.brushSizes[state.sizeIndex];
    const r = Math.max(9, size * 0.7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.pinching ? r * 0.75 : r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = state.erase ? '#ffffff' : CONFIG.palette[state.colorIndex];
    ctx.stroke();
    if (p.pinching) {
      ctx.globalAlpha = state.erase ? 0.25 : 0.75;
      ctx.fillStyle = state.erase ? '#ffffff' : CONFIG.palette[state.colorIndex];
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ui.draw(ctx, state, hovered);
}

// --- mouse fallback, handy for testing without stepping in front of a camera
const mouse = {
  active: false,
  over: false,
  x: 0,
  y: 0,
  down: false,
  pressed: false,
  released: false,
  take() {
    const p = {
      id: 'mouse',
      x: this.x,
      y: this.y,
      pinching: this.down,
      pressed: this.pressed,
      released: this.released,
      strength: 1,
    };
    this.pressed = false;
    this.released = false;
    if (!this.down && !this.over) this.active = false;
    return p;
  },
  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this.active = true;
  },
};

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !e.isPrimary) return;
  e.preventDefault();
  const p = toCanvas(e.clientX, e.clientY);
  mouse.moveTo(p.x, p.y);
  mouse.over = true;
  mouse.down = true;
  mouse.pressed = true;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e.clientX, e.clientY);
  mouse.moveTo(p.x, p.y);
  mouse.over = true;
});

canvas.addEventListener('pointerup', () => {
  if (!mouse.down) return;
  mouse.down = false;
  mouse.released = true;
  mouse.active = true;
});

canvas.addEventListener('pointerleave', () => {
  mouse.over = false;
  if (mouse.down) {
    mouse.down = false;
    mouse.released = true;
    mouse.active = true;
  }
});

// --- keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (!painter) return;
  const key = e.key.toLowerCase();

  if (key >= '1' && key <= String(Math.min(9, CONFIG.palette.length))) {
    state.colorIndex = Number(key) - 1;
    state.erase = false;
  } else if (key === 'z') painter.undo();
  else if (key === 'c') painter.clear();
  else if (key === 'e') state.erase = !state.erase;
  else if (key === 'm') state.symmetry = !state.symmetry;
  else if (key === '[') state.sizeIndex = Math.max(0, state.sizeIndex - 1);
  else if (key === ']') state.sizeIndex = Math.min(CONFIG.brushSizes.length - 1, state.sizeIndex + 1);
  else if (key === 'b') {
    const order = ['solid', 'neon', 'spray'];
    state.style = order[(order.indexOf(state.style) + 1) % order.length];
    state.erase = false;
  } else if (key === 'h') {
    ui.visible = !ui.visible;
    hudEl.classList.toggle('hidden', !ui.visible);
  } else if (key === 's') snapshot();
  else if (key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } else return;

  e.preventDefault();
});

function snapshot() {
  const wasVisible = ui.visible;
  ui.visible = false;
  draw([]);
  canvas.toBlob((blob) => {
    ui.visible = wasVisible;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `face-paint-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

window.addEventListener('resize', layout);
document.getElementById('start').addEventListener('click', start);
document.getElementById('retry').addEventListener('click', start);
