import { CONFIG } from './config.js';

// Face landmarks anchor everything, hand landmarks are the only input, and the
// segmenter lifts the visitor off their background live. Everything handed
// back is already mirrored, so the rest of the app works in display space.
export class Tracker {
  constructor() {
    this.face = null;
    this.hands = null;
    this.segmenter = null;
    this.lastVideoTime = -1;
    this.frame = 0;
    this.result = { face: null, hands: [], mask: null };
    this.personLabel = null;
    this.maskBytes = null;
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

    // The cut-out is a nicety. Without it the camera image simply fills the
    // frame instead of sitting on paper, and everything else still works.
    if (CONFIG.liveCutout) {
      try {
        this.segmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: CONFIG.segmentModel, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch (err) {
        console.warn('Segmenter unavailable; running without the cut-out', err);
        this.segmenter = null;
      }
    }
  }

  detect(video) {
    if (video.currentTime === this.lastVideoTime) return this.result;
    this.lastVideoTime = video.currentTime;
    this.frame++;

    const ts = performance.now();
    const faceOut = this.face.detectForVideo(video, ts);
    const handOut = this.hands.detectForVideo(video, ts);

    const face = faceOut.faceLandmarks?.[0] ? mirror(faceOut.faceLandmarks[0]) : null;

    this.result = {
      face,
      hands: (handOut.landmarks ?? []).map((lm, i) => ({
        landmarks: mirror(lm),
        id: handOut.handedness?.[i]?.[0]?.categoryName ?? `hand${i}`,
      })),
      // Segmentation is the expensive one, so it runs at a fraction of the
      // rate; the silhouette moves slowly enough that nobody can tell.
      mask: this.frame % CONFIG.cutoutEveryNFrames === 0
        ? this.#segment(video, ts, face) ?? this.result.mask
        : this.result.mask,
    };
    return this.result;
  }

  #segment(video, ts, face) {
    if (!this.segmenter) return null;
    try {
      const res = this.segmenter.segmentForVideo(video, ts);
      const mask = res?.categoryMask;
      if (!mask) return null;

      const data = mask.getAsUint8Array();
      const { width, height } = mask;

      // Which label means "person" is not guaranteed, so read it off a pixel
      // we know is on the visitor: the tip of their nose. The landmark is
      // mirrored and the mask is not, hence the flip.
      if (face) {
        const p = face[1] ?? face[0];
        const px = clampIndex((1 - p.x) * width, width);
        const py = clampIndex(p.y * height, height);
        this.personLabel = data[py * width + px];
      }
      if (this.personLabel === null) return null;

      if (!this.maskBytes || this.maskBytes.length !== data.length) {
        this.maskBytes = new Uint8Array(data.length);
      }
      for (let i = 0; i < data.length; i++) {
        this.maskBytes[i] = data[i] === this.personLabel ? 255 : 0;
      }
      mask.close();
      res.close?.();
      return { data: this.maskBytes, width, height };
    } catch (err) {
      console.warn('segmentation failed; continuing without it', err);
      this.segmenter = null;
      return null;
    }
  }
}

function clampIndex(v, size) {
  return Math.min(size - 1, Math.max(0, Math.round(v)));
}

function mirror(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}
