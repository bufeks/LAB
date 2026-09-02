import { CONFIG } from './config.js';

// Face landmarks frame the shot, hand landmarks drive the interaction, and the
// segmenter cuts the visitor out of their background exactly once, at capture.
// Everything handed back is already mirrored.
export class Tracker {
  constructor() {
    this.face = null;
    this.hands = null;
    this.segmenter = null;
    this.lastVideoTime = -1;
    this.result = { face: null, hands: [] };
  }

  async init() {
    // Loaded at run time so an unreachable CDN is a handled error rather than
    // a page that never boots.
    const { FilesetResolver, FaceLandmarker, HandLandmarker, ImageSegmenter } =
      await import(/* @vite-ignore */ CONFIG.visionModule);

    const fileset = await FilesetResolver.forVisionTasks(CONFIG.wasmBase);

    const build = async (delegate) => ({
      face: await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.faceModel, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      }),
      hands: await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.handModel, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
    });

    let built;
    try {
      built = await build('GPU');
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      built = await build('CPU');
    }
    this.face = built.face;
    this.hands = built.hands;

    // The cut-out is a nicety: if the segmenter will not load, the portrait
    // falls back to a soft oval and the piece still works.
    try {
      this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: CONFIG.segmentModel, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    } catch (err) {
      console.warn('Segmenter unavailable; falling back to an oval mask', err);
      this.segmenter = null;
    }
  }

  detect(video, wantFace, wantHands) {
    if (video.currentTime === this.lastVideoTime) return this.result;
    this.lastVideoTime = video.currentTime;

    const ts = performance.now();
    const out = { face: null, hands: [] };

    if (wantFace) {
      const r = this.face.detectForVideo(video, ts);
      out.face = r.faceLandmarks?.[0] ? mirror(r.faceLandmarks[0]) : null;
    }
    if (wantHands) {
      const r = this.hands.detectForVideo(video, ts);
      out.hands = (r.landmarks ?? []).map((lm, i) => ({
        landmarks: mirror(lm),
        id: r.handedness?.[i]?.[0]?.categoryName ?? `hand${i}`,
      }));
    }

    this.result = out;
    return out;
  }

  // Returns { data, width, height, personLabel } or null. The source must
  // already be mirrored, because the mask is used against a mirrored frame.
  segment(source, probe) {
    if (!this.segmenter) return null;
    let out = null;
    try {
      const res = this.segmenter.segment(source);
      const mask = res.categoryMask;
      if (mask) {
        const data = Uint8Array.from(mask.getAsUint8Array());
        const { width, height } = mask;
        // Which label means "person" is not guaranteed, so read it off the
        // pixel we know is on the visitor: the middle of their face.
        const px = Math.min(width - 1, Math.max(0, Math.round(probe.x * width)));
        const py = Math.min(height - 1, Math.max(0, Math.round(probe.y * height)));
        out = { data, width, height, personLabel: data[py * width + px] };
        mask.close();
      }
      res.close?.();
    } catch (err) {
      console.warn('segmentation failed', err);
    }
    return out;
  }
}

function mirror(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}
