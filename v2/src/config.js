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
  // the surface barely moves there. Everything here is a multiple of the eye's
  // own size, so it holds for any face at any distance from the camera.
  protectEyes: true,
  eyeGuard: {
    // The boundary paint stops at is the eyelid rim itself, read off the lid
    // landmarks: `margin` is how far past the lashes it sits, and `soft` how
    // sharply it arrives. rx/ry are only a size reference for the rigid
    // handling and the grading, both of which want a whole socket, not a slit.
    margin: 1.05, soft: 0.86,
    // A rim can only ever be this big or this small next to the eye's own
    // width. One badly tracked frame is then a slightly wrong eye rather
    // than a hole punched through the middle of the paint.
    lidClamp: [0.12, 1.25],
    rx: 1.08, ry: 0.8,
    // Paint has to stop sharply at the lid, but the deformation must not:
    // the same narrow ramp there shows up as a hard-edged lens. It is held
    // off over a rounder shape too, so a squeeze cannot close the socket.
    deformSoft: 0.15, deformRound: 0.7,
    // The eyes are not pinned in place - that made them read as two lenses
    // glued to a face sliding away underneath. They take the average of the
    // displacement around them instead: they travel with the flesh, they just
    // do not distort. 1 is fully rigid, 0 lets them deform like everything else.
    rigid: 1, deformScale: 1.75,
    // Local contrast around the eye. Off: it read as a processed patch on an
    // otherwise untouched face. `grade` above 0 brings it back, in colour,
    // proportional to how buried in paint the eye already is.
    grade: 0,
    punch: 1.9, lift: 0.02, gradeFrom: 0.30, gradeTo: 1.15,
  },

  deformGrid: 192,
  deformStrength: 0.38,   // maximum displacement, in eye-distances
  deformRadius: 0.5,      // brush radius, in eye-distances
  deformGain: 0.55,       // how much of the hand's travel is transferred

  brushSizes: [22, 42, 78],   // in ink-canvas pixels, so they scale with the face

  // --- gestures -------------------------------------------------------------
  // Every action takes two deliberate parts: hold the shape until it is
  // armed, then move. Nothing fires from a pose alone, which is what stops
  // the piece being wrecked the instant a hand enters the frame.
  gesture: {
    pinchOn: 0.40,
    pinchOff: 0.60,
    holdFrames: 3,        // frames a new pose must persist before it takes over
    armFrames: 8,         // and then this long before it may act at all
    smoothing: 0.45,

    // How far ahead of the hand a thrown blot lands, in frames of travel.
    // Smoothed positions lag, so impacts are taken from the raw anchor and
    // this is all the lead there is.
    lead: 0.5,

    // px/frame of hand travel each action demands.
    speed: { fist: 17, open: 22, point: 6, pinch: 2 },
    // ms before the same hand may fire the same one-shot again.
    cooldown: { fist: 300, open: 1200 },

    // Two open palms closing on the head. Taking precedence over the slap is
    // the whole trick: both are open hands in motion, and what separates them
    // is whether they are travelling towards each other or towards the face.
    crush: {
      closeSpeed: 5,     // px/frame the gap has to be shrinking by
      maxGap: 5.5,       // and how near, in eye-distances, before it counts
      strength: 0.5,     // how much of the closing is transferred
      band: 1.5,         // reach either side of the line between the hands
      bulge: 0.45,       // how much the squeezed material swells sideways
    },

    // The same two palms turning about each other instead of closing. Both
    // can happen at once, which is what wringing actually is.
    twist: {
      turnSpeed: 0.016,  // radians per frame before it counts
      strength: 0.85,    // how much of the turn is transferred
      reach: 1.5,        // radius, as a multiple of half the distance apart
      maxStep: 0.5,      // ignore jumps this large: the hands swapped identity
    },

    // A pinch grabs more when the hand is nearer the camera than the face,
    // which is the only handle on grab size that needs no UI at all.
    handRefSpan: 1.4,    // hand span, in eye-distances, that means "normal"
    handGrab: [0.6, 2.2],
  },

  // --- look -----------------------------------------------------------------
  // A thick wet coat rather than a decal. `form` lets the modelling of the
  // head read through the pigment, `relief` is the bevel of the paint's own
  // edge, `formRelief` bends the highlight around the skull, and `gloss` is
  // how wet it looks.
  paint: { form: 0.85, relief: 18, formRelief: 3.2, gloss: 0.8, shadow: 0.42,
           faceRelief: 1.15, sculpt: 0.55 },

  // Resolution of the depth map recovered from the face landmarks, and the
  // steepest slope it can express, in depth per eye-distance.
  depthGrid: 72,
  depthRange: 3.0,

  // Fresh paint keeps creeping into itself for a while, then sets. This is
  // what makes neighbouring colours bleed together instead of stacking.
  bleedEveryNFrames: 4,
  bleedRadius: 0.62,   // gentle: a heavier blur eats the fine spatter

  // The snapshot the brushes read for mixing, and that runs are seeded from,
  // is refreshed on its own beat. It used to ride on the diffusion pass, so
  // turning that down to save time silently disabled both.
  probeEveryNFrames: 6,

  // Wet-on-wet: a mark picks up the colour it lands in and carries it, so
  // yellow dragged through blue goes green at the meeting instead of simply
  // covering it.
  pickup: 0.5,
  // Mixing happens in density space rather than in RGB. Interpolating RGB
  // sends yellow through grey on its way to blue; absorbing like pigment
  // sends it through green, which is what a viewer expects of paint.
  mixFloor: 0.012,   // keeps a pure channel from having infinite density
  speckRadius: 2.6,  // below this a mark is a crisp speck, not a soft stamp
  spatter: 1,          // multiplier on how many droplets fly

  // Runs are not placed: they form wherever paint has piled up and found a
  // lower edge to fall off, and they carry the colour that is already there.
  drip: {
    seedEveryNFrames: 7,
    perSeed: 3,
    // Only paint fresh enough to still be moving starts new runs. Runs of
    // their own keep the layer damp, and without this floor they would go on
    // seeding each other indefinitely.
    seedWetness: 8,
    maxRuns: 80,
    minMass: 0.28,     // how much paint has to be stacked above an edge
    // Slow and viscous. How far a run goes is set by what it is carrying, not
    // by these, so lowering them lengthens the fall in time without
    // shortening it in distance.
    hang: [0.4, 2.2],    // seconds a bead swells before it lets go
    gravity: 95,       // ink-canvas px per second squared
    maxSpeed: 44,
  },

  // Paint belongs on the body. Anything thrown past it misses and is simply
  // not there, rather than landing on the paper behind.
  inkOnBodyOnly: true,

  // Segmentation counts the visitor's hands as part of the visitor, so paint
  // meant for a face would show on the hand in front of it. The hands are
  // drawn into their own mask and cut back out.
  maskHands: true,
  handMaskWidth: 192,
  handDilate: 0.3,     // fraction of hand span the mask grows by

  liveCutout: true,
  cutoutEveryNFrames: 2,   // segmentation is the expensive one; halve its rate

  // 1 keeps the visitor in colour, 0 renders them as a graphite bust. The
  // eyes are graded towards grey either way, because a white and a dark iris
  // is what makes them read.
  bodyColour: 1,
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

  // Unattended installation: once the visitor has gone, wipe the piece so the
  // next person starts on their own face. 0 leaves it standing.
  idleResetMs: 12000,
};

export const POSES = {
  crush: { id: 'crush', label: '潰す', en: 'CRUSH' },
  twist: { id: 'twist', label: 'ねじる', en: 'TWIST' },
  fist: { id: 'fist', label: 'ぶつける', en: 'THROW' },
  point: { id: 'point', label: '塗る', en: 'PAINT' },
  open: { id: 'open', label: 'ぶちまける', en: 'POUR' },
  pinch: { id: 'pinch', label: '歪ませる', en: 'BREAK' },
};
