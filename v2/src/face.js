import { CONFIG } from './config.js';

// Stable landmarks: the outer eye corners set rotation and scale, the bridge
// of the nose sets the origin.
const EYE_L = 33;
const EYE_R = 263;
const NASION = 168;

// Corner pairs for each eye: [outer, inner].
const EYE_SPANS = [[33, 133], [263, 362]];

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
    this.eyes = { a: { x: -0.5, y: -0.1 }, b: { x: 0.5, y: -0.1 }, rx: 0.24, ry: 0.2 };
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
      this.pts = landmarks.map((p) => ({ x: p.x * sx, y: p.y }));
    } else {
      for (let i = 0; i < landmarks.length; i++) {
        const t = this.pts[i];
        t.x += (landmarks[i].x * sx - t.x) * (1 - a);
        t.y += (landmarks[i].y - t.y) * (1 - a);
      }
    }

    const l = this.pts[EYE_L];
    const r = this.pts[EYE_R];
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

  // Both eyes, in the head's own frame. Sized from the eye's corner-to-corner
  // width rather than its lid opening, so blinking does not shrink the guard.
  #measureEyes() {
    const centres = EYE_SPANS.map(([outer, inner]) => {
      const o = this.pts[outer];
      const i = this.pts[inner];
      const mid = this.#local((o.x + i.x) / 2, (o.y + i.y) / 2);
      return { mid, half: Math.hypot(o.x - i.x, o.y - i.y) / 2 / this.scale };
    });
    const half = (centres[0].half + centres[1].half) / 2;
    this.eyes = {
      a: centres[0].mid,
      b: centres[1].mid,
      rx: half * CONFIG.eyeGuard.rx,
      ry: half * CONFIG.eyeGuard.ry,
    };
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
