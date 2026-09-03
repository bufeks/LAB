import { CONFIG } from './config.js';

// Stable landmarks: the outer eye corners set rotation and scale, the bridge
// of the nose sets the origin.
//
// The landmarks arrive mirrored, so 33 - the outer corner of the visitor's
// right eye - is the one on the RIGHT of the display, and 263 is on the left.
// Taking the axis in that order makes the frame's x run the same way as the
// screen's, and therefore its y point down. Get this backwards and runs fall
// upwards.
const EYE_SCREEN_LEFT = 263;
const EYE_SCREEN_RIGHT = 33;
const NASION = 168;

// Corner pairs for each eye: [outer, inner].
const EYE_SPANS = [[33, 133], [263, 362]];

// The lid rims themselves, in order around each eye. These sit on the lash
// line, so a guard built from them lets paint run right up to the lashes
// instead of stopping at a generous ellipse drawn around the whole socket.
const EYE_RINGS = [
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
];

// The rim is sampled as a radius per angle, which is all the shader needs to
// ask "am I inside this eye?" for an arbitrary shape at the price of a lookup.
const LID_BINS = 32;

// A blink collapses the rim to a line. The aperture is therefore remembered
// rather than measured: it follows the eye open immediately and closes only
// over a couple of seconds, so nothing is ever painted onto a shut eye and
// revealed when it opens again.
const LID_DECAY = 0.995;

// All geometry happens in "aspect-corrected screen space", which is simply
// pixels divided by the frame height. Distances there are isotropic, and a
// screen UV maps to it as (u * aspect, v) - the same expression the shader
// uses, so JS and GLSL cannot drift apart.
export class FaceFrame {
  constructor() {
    this.present = false;
    this.pts = null;
    this.origin = { x: 0, y: 0 };
    this.axisU = { x: 1, y: 0 };
    this.axisV = { x: 0, y: 1 };
    this.scale = 1;
    this.eyes = {
      a: { x: -0.5, y: -0.1 }, b: { x: 0.5, y: -0.1 }, rx: 0.24, ry: 0.2,
      lids: [new Float32Array(LID_BINS).fill(0.2), new Float32Array(LID_BINS).fill(0.2)],
    };
    // Aperture per angle, in units of the eye's own half width, so it does
    // not have to be re-learned when the visitor leans in or out.
    this.lidMax = [new Float32Array(LID_BINS), new Float32Array(LID_BINS)];
    this.lostSince = 0;
  }

  update(landmarks, width, height, now) {
    if (!landmarks) {
      if (this.present) this.lostSince = now;
      this.present = false;
      return;
    }

    const a = CONFIG.faceSmoothing;
    const sx = width / height;
    if (!this.pts || this.pts.length !== landmarks.length || !this.present) {
      // z arrives on roughly the same scale as x, so it gets the same
      // aspect correction and lives in the same units as everything else.
      this.pts = landmarks.map((p) => ({ x: p.x * sx, y: p.y, z: (p.z ?? 0) * sx }));
      // A new face brings its own eyes; nothing about the last one applies.
      this.lidMax[0].fill(0);
      this.lidMax[1].fill(0);
    } else {
      for (let i = 0; i < landmarks.length; i++) {
        const t = this.pts[i];
        t.x += (landmarks[i].x * sx - t.x) * (1 - a);
        t.y += (landmarks[i].y - t.y) * (1 - a);
        t.z += ((landmarks[i].z ?? 0) * sx - t.z) * (1 - a);
      }
    }

    const l = this.pts[EYE_SCREEN_LEFT];
    const r = this.pts[EYE_SCREEN_RIGHT];
    const s = Math.hypot(r.x - l.x, r.y - l.y) || 1e-4;
    this.scale = s;
    this.axisU = { x: (r.x - l.x) / s, y: (r.y - l.y) / s };
    // A perpendicular keeps the mapping a similarity: the head can turn and
    // approach the camera, but ink never shears.
    this.axisV = { x: -this.axisU.y, y: this.axisU.x };
    this.origin = { ...this.pts[NASION] };
    this.present = true;
    this.#measureEyes();
  }

  // Both eyes, in the head's own frame: the lid rim as a radius per angle,
  // plus a coarse pair of radii that the rigid handling and the grading use
  // as a size reference. Only the rim decides where paint may go.
  #measureEyes() {
    const eyes = EYE_SPANS.map(([outer, inner], side) => {
      const o = this.pts[outer];
      const i = this.pts[inner];
      const half = Math.hypot(o.x - i.x, o.y - i.y) / 2 / this.scale;
      // The corners, not the rim's centre of mass: an eye half shut still has
      // its corners where they were, so the rays go out from the same place.
      const mid = this.#local((o.x + i.x) / 2, (o.y + i.y) / 2);
      const rim = EYE_RINGS[side].map((k) => this.#local(this.pts[k].x, this.pts[k].y));
      return { mid, half, lids: this.#lidRadii(rim, mid, half, side) };
    });
    const half = (eyes[0].half + eyes[1].half) / 2;
    this.eyes = {
      a: eyes[0].mid,
      b: eyes[1].mid,
      rx: half * CONFIG.eyeGuard.rx,
      ry: half * CONFIG.eyeGuard.ry,
      lids: [eyes[0].lids, eyes[1].lids],
    };
  }

  // Cast a ray out of the eye's centre at each of LID_BINS angles and take
  // where it leaves the rim polygon. The result is remembered per angle so a
  // blink cannot pull it in, then pushed out by `margin` - the sliver of skin
  // over the lashes that should still take paint.
  #lidRadii(rim, mid, half, side) {
    const remembered = this.lidMax[side];
    const out = new Float32Array(LID_BINS);
    const margin = CONFIG.eyeGuard.margin;
    const [lo, hi] = CONFIG.eyeGuard.lidClamp;
    for (let b = 0; b < LID_BINS; b++) {
      const a = (b / LID_BINS) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      let hit = 0;
      for (let e = 0; e < rim.length; e++) {
        const p = rim[e];
        const q = rim[(e + 1) % rim.length];
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const den = uy * ex - ux * ey;
        if (Math.abs(den) < 1e-9) continue;
        const px = p.x - mid.x;
        const py = p.y - mid.y;
        const s = (ux * py - uy * px) / den;      // along the edge
        if (s < 0 || s > 1) continue;
        const t = (ex * py - ey * px) / den;      // along the ray
        if (t > hit) hit = t;
      }
      const seen = Math.min(Math.max(hit / (half || 1e-4), lo), hi);
      const kept = Math.max(seen, remembered[b] * LID_DECAY);
      remembered[b] = kept;
      out[b] = kept * half * margin;
    }
    return out;
  }

  // A point already in aspect-corrected screen space -> eye-distance units.
  #local(x, y) {
    const dx = x - this.origin.x;
    const dy = y - this.origin.y;
    return {
      x: (dx * this.axisU.x + dy * this.axisU.y) / this.scale,
      y: (dx * this.axisV.x + dy * this.axisV.y) / this.scale,
    };
  }

  idleFor(now) {
    return this.present ? 0 : now - this.lostSince;
  }

  // Screen pixels -> eye-distance units around the bridge of the nose.
  toFace(px, py, width, height) {
    const dx = px / height - this.origin.x;
    const dy = py / height - this.origin.y;
    return {
      x: (dx * this.axisU.x + dy * this.axisU.y) / this.scale,
      y: (dx * this.axisV.x + dy * this.axisV.y) / this.scale,
    };
  }

  // Screen pixels -> pixels in the ink canvas.
  toInk(px, py, width, height) {
    const f = this.toFace(px, py, width, height);
    const e = CONFIG.faceExtent;
    return {
      x: (CONFIG.faceCentre.x + f.x / e) * CONFIG.inkSize,
      y: (CONFIG.faceCentre.y + f.y / e) * CONFIG.inkSize,
    };
  }

  // Screen pixels -> [0,1] across the ink canvas, which is also the space the
  // displacement field is indexed in.
  toFaceUv(px, py, width, height) {
    const f = this.toFace(px, py, width, height);
    const e = CONFIG.faceExtent;
    return {
      x: CONFIG.faceCentre.x + f.x / e,
      y: CONFIG.faceCentre.y + f.y / e,
    };
  }

  // A screen-space delta expressed in eye-distances, for pushing the field.
  deltaToFace(dx, dy, height) {
    const ux = dx / height;
    const uy = dy / height;
    return {
      x: (ux * this.axisU.x + uy * this.axisU.y) / this.scale,
      y: (ux * this.axisV.x + uy * this.axisV.y) / this.scale,
    };
  }
}
