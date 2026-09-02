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

  pinchOn: 0.42,
  pinchOff: 0.62,
  handSmoothing: 0.5,

  // Frames of continuous face detection before the shutter arms itself.
  autoShutterFrames: 40,
  countdownSeconds: 3,

  // The ink layer runs below camera resolution: it is all soft blobs and
  // runs, and a smaller texture keeps the per-frame GPU upload cheap.
  inkScale: 0.75,

  // Displacement field resolution. Small on purpose - the deformation is
  // meant to read as clay being pushed, not as a precise warp.
  deformGrid: { w: 192, h: 108 },
  deformStrength: 0.13,   // maximum displacement, in UV units
  deformRadius: 0.11,     // brush radius, in UV units

  brushSizes: [26, 52, 96],

  palette: [
    { id: 'ink', hex: '#12111a', label: 'INK' },
    { id: 'magenta', hex: '#e5006e', label: 'MAGENTA' },
    { id: 'blue', hex: '#3a3fd6', label: 'BLUE' },
    { id: 'cyan', hex: '#00c2d1', label: 'CYAN' },
    { id: 'acid', hex: '#d8e000', label: 'ACID' },
    { id: 'bone', hex: '#f4f0e6', label: 'BONE' },
  ],

  paper: '#efeae0',

  historyLimit: 10,
};
