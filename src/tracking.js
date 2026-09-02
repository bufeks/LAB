import { CONFIG } from './config.js';

// Wraps the two MediaPipe detectors. Everything it hands back is already
// mirrored, so the rest of the app can work in "what the visitor sees"
// coordinates and never think about the flip again.
export class Tracker {
  constructor() {
    this.face = null;
    this.hands = null;
    this.faceOvalRing = [];
    this.lastVideoTime = -1;
    this.result = { face: null, hands: [] };
  }

  async init() {
    // Imported at run time rather than at module scope so that an unreachable
    // CDN surfaces as a handled error instead of a page that never boots.
    const { FilesetResolver, FaceLandmarker, HandLandmarker } =
      await import(/* @vite-ignore */ CONFIG.visionModule);

    const fileset = await FilesetResolver.forVisionTasks(CONFIG.wasmBase);

    const build = async (delegate) => {
      const face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.faceModel, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      const hands = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.handModel, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      return { face, hands };
    };

    let built;
    try {
      built = await build('GPU');
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      built = await build('CPU');
    }
    this.face = built.face;
    this.hands = built.hands;
    this.faceOvalRing = orderRing(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);
  }

  // Returns the previous result when the video has not produced a new frame,
  // which keeps the detectors' monotonic-timestamp contract intact.
  detect(video) {
    if (video.currentTime === this.lastVideoTime) return this.result;
    this.lastVideoTime = video.currentTime;

    const ts = performance.now();
    const faceOut = this.face.detectForVideo(video, ts);
    const handOut = this.hands.detectForVideo(video, ts);

    this.result = {
      face: faceOut.faceLandmarks?.[0] ? mirror(faceOut.faceLandmarks[0]) : null,
      hands: (handOut.landmarks ?? []).map((lm, i) => ({
        landmarks: mirror(lm),
        // The label is only used as a stable identity for smoothing; mirroring
        // the image swaps its meaning, which does not matter for that purpose.
        id: handOut.handedness?.[i]?.[0]?.categoryName ?? `hand${i}`,
      })),
    };
    return this.result;
  }
}

function mirror(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

// MediaPipe ships the face oval as an unordered set of directed edges. Walking
// start -> end turns it into a single closed ring we can use as a clip path.
function orderRing(connections) {
  const next = new Map();
  for (const c of connections) next.set(c.start, c.end);
  if (next.size === 0) return [];

  const first = connections[0].start;
  const ring = [first];
  let node = next.get(first);
  while (node !== undefined && node !== first && ring.length <= next.size) {
    ring.push(node);
    node = next.get(node);
  }
  return ring;
}
