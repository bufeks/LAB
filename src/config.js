// Everything an installer might want to change lives here.
//
// The model files are fetched from Google's CDN by default. For a kiosk /
// installation without reliable network, run `scripts/fetch-models.sh` and
// switch the three paths below to the local copies (see README).

const TASKS_VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

export const CONFIG = {
  visionModule: `${TASKS_VISION}/vision_bundle.mjs`,
  wasmBase: `${TASKS_VISION}/wasm`,
  faceModel: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  handModel: `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,

  camera: { width: 1280, height: 720, facingMode: 'user' },

  // Pinch is detected on the thumb-tip / index-tip distance, normalised by the
  // size of the hand so it works at any distance from the camera. Two
  // thresholds give hysteresis, which stops the brush flickering on and off.
  pinchOn: 0.42,
  pinchOff: 0.62,

  // Exponential smoothing, 0 = no smoothing, 1 = frozen.
  faceSmoothing: 0.45,
  handSmoothing: 0.5,

  // Minimum distance in pixels between two samples of a stroke.
  minSampleDistance: 2.5,

  brushSizes: [9, 18, 34],
  palette: [
    '#ff2d55', '#ff9500', '#ffe600', '#37e04a',
    '#00d5ff', '#4d5dff', '#c04dff', '#ffffff',
  ],

  // How far outside the face-oval paint is still shown, as a scale factor
  // around the face centre. 1.0 clips exactly at the silhouette.
  faceClipInflate: 1.03,

  // Unattended-installation helper: wipe the canvas after this many
  // milliseconds without a face, so the next visitor starts clean.
  // 0 disables it.
  idleClearMs: 0,
};
