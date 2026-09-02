// Tuning for BREAK TO CREATE. Everything an installer touches lives here.

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

// Absolute URLs, resolved against this file. MediaPipe resolves its wasm base
// against the *page*, while a dynamic import resolves against the *module* -
// pinning both here means a relative vendor path means one thing only, and
// the piece can be served from any subdirectory. Absolute URLs pass through.
const at = (path) => new URL(path, import.meta.url).href;

export const CONFIG = {
  visionModule: at(`${TASKS_VISION}/vision_bundle.mjs`),
  wasmBase: at(`${TASKS_VISION}/wasm`),
  faceModel: at(`${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`),
  handModel: at(`${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`),
  segmentModel: at(`${MODELS}/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite`),

  camera: { width: 1280, height: 720, facingMode: 'user' },

  // --- the face-local canvas ------------------------------------------------
  // Ink and deformation are stored in a space anchored to the head, measured
  // in eye-corner distances. That is what keeps marks on the face while the
  // visitor moves, and it lets runs crawl down the face rather than down the
  // screen.
  inkSize: 1024,
  faceExtent: 8,                     // eye-distances across the ink canvas
  faceCentre: { x: 0.5, y: 0.34 },   // where the bridge of the nose sits in it
  faceSmoothing: 0.4,

  // The eyes survive whatever happens around them: ink never covers them and
  // the surface barely moves there. Radii are multiples of the eye's own
  // corner-to-corner width, so they hold for any face and any distance.
  protectEyes: true,
  eyeGuard: { rx: 1.45, ry: 1.25, soft: 0.72, deform: 0.15 },

  deformGrid: 192,
  deformStrength: 0.55,   // maximum displacement, in eye-distances
  deformRadius: 0.6,      // brush radius, in eye-distances

  brushSizes: [30, 62, 116],   // in ink-canvas pixels, so they scale with the face

  // --- gestures -------------------------------------------------------------
  gesture: {
    pinchOn: 0.40,
    pinchOff: 0.60,
    holdFrames: 3,        // frames a new pose must persist before it takes over
    throwSpeed: 13,       // px/frame of hand travel that counts as a throw
    throwCooldown: 220,   // ms between thrown blots
    pourCooldown: 1100,   // ms between buckets
    smoothing: 0.45,
  },

  // --- look -----------------------------------------------------------------
  liveCutout: true,
  cutoutEveryNFrames: 2,   // segmentation is the expensive one; halve its rate
  contrast: 1.55,
  brightness: 0.03,
  paper: [0.937, 0.918, 0.878],

  dwellMs: 620,            // touchless selection: how long to hold over a control

  palette: [
    { id: 'ink', hex: '#12111a', label: 'INK' },
    { id: 'magenta', hex: '#e5006e', label: 'MAGENTA' },
    { id: 'blue', hex: '#3a3fd6', label: 'BLUE' },
    { id: 'cyan', hex: '#00c2d1', label: 'CYAN' },
    { id: 'acid', hex: '#d8e000', label: 'ACID' },
    { id: 'bone', hex: '#f4f0e6', label: 'BONE' },
  ],

  historyLimit: 10,
};

export const POSES = {
  fist: { id: 'fist', label: 'ぶつける', en: 'THROW' },
  point: { id: 'point', label: '塗る', en: 'PAINT' },
  open: { id: 'open', label: 'ぶちまける', en: 'POUR' },
  pinch: { id: 'pinch', label: '歪ませる', en: 'BREAK' },
};
