import { CONFIG } from './config.js';

// Landmarks that barely move with expression, used to build a stable
// similarity frame (origin, rotation, scale) for the head.
const EYE_L = 33;
const EYE_R = 263;
const NASION = 168;

// 0..467 are the mesh; 468..477 are the irises, which follow the gaze and
// would make paint anchored to them swim around.
const MESH_COUNT = 468;

// Holds the current head pose in pixel space and converts between screen
// coordinates and coordinates that are attached to the face.
export class FaceModel {
  constructor(ovalRing) {
    this.ring = ovalRing;
    this.pts = null;      // smoothed landmarks, in canvas pixels
    this.frame = null;    // { ox, oy, ux, uy, vx, vy, s }
    this.present = false;
    this.lostSince = 0;
  }

  update(landmarks, width, height, now) {
    if (!landmarks) {
      if (this.present) this.lostSince = now;
      this.present = false;
      return;
    }

    const a = CONFIG.faceSmoothing;
    if (!this.pts || this.pts.length !== landmarks.length || !this.present) {
      this.pts = landmarks.map((p) => ({ x: p.x * width, y: p.y * height }));
    } else {
      for (let i = 0; i < landmarks.length; i++) {
        const t = this.pts[i];
        t.x += (landmarks[i].x * width - t.x) * (1 - a);
        t.y += (landmarks[i].y * height - t.y) * (1 - a);
      }
    }

    const l = this.pts[EYE_L];
    const r = this.pts[EYE_R];
    const s = Math.hypot(r.x - l.x, r.y - l.y) || 1;
    const ux = (r.x - l.x) / s;
    const uy = (r.y - l.y) / s;
    const o = this.pts[NASION];

    // v is u rotated by 90 degrees, which keeps the frame a similarity
    // transform: paint can rotate and scale with the head but never shears.
    this.frame = { ox: o.x, oy: o.y, ux, uy, vx: -uy, vy: ux, s };
    this.present = true;
  }

  idleFor(now) {
    return this.present ? 0 : now - this.lostSince;
  }

  // Nearest mesh landmarks to a screen point, with inverse-square weights.
  anchorsFor(x, y, k = 4) {
    const best = [];
    for (let i = 0; i < MESH_COUNT; i++) {
      const p = this.pts[i];
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (best.length < k) {
        best.push({ i, d2 });
        best.sort((m, n) => m.d2 - n.d2);
      } else if (d2 < best[k - 1].d2) {
        best[k - 1] = { i, d2 };
        best.sort((m, n) => m.d2 - n.d2);
      }
    }

    const f = this.frame;
    let total = 0;
    const anchors = best.map(({ i, d2 }) => {
      const p = this.pts[i];
      const dx = x - p.x;
      const dy = y - p.y;
      const w = 1 / (d2 + f.s * 0.5);
      total += w;
      return {
        i,
        lx: (dx * f.ux + dy * f.uy) / f.s,
        ly: (dx * f.vx + dy * f.vy) / f.s,
        w,
      };
    });

    for (const anchor of anchors) anchor.w /= total;
    return anchors;
  }

  // Inverse of anchorsFor: where does that face-attached point sit now?
  resolve(anchors, out) {
    const f = this.frame;
    let x = 0;
    let y = 0;
    for (const a of anchors) {
      const p = this.pts[a.i];
      const ox = (a.lx * f.ux + a.ly * f.vx) * f.s;
      const oy = (a.lx * f.uy + a.ly * f.vy) * f.s;
      x += a.w * (p.x + ox);
      y += a.w * (p.y + oy);
    }
    out.x = x;
    out.y = y;
    return out;
  }

  // Mirror a screen point across the face midline.
  reflect(x, y) {
    const f = this.frame;
    const dx = x - f.ox;
    const dy = y - f.oy;
    const du = dx * f.ux + dy * f.uy;
    const dv = dx * f.vx + dy * f.vy;
    return {
      x: f.ox - du * f.ux + dv * f.vx,
      y: f.oy - du * f.uy + dv * f.vy,
    };
  }

  contains(x, y) {
    if (!this.present || this.ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = this.ring.length - 1; i < this.ring.length; j = i++) {
      const a = this.pts[this.ring[i]];
      const b = this.pts[this.ring[j]];
      if ((a.y > y) !== (b.y > y) &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Silhouette path, slightly inflated so brush strokes are not shaved off
  // right at the edge of the face.
  tracePath(ctx, inflate = CONFIG.faceClipInflate) {
    let cx = 0;
    let cy = 0;
    for (const i of this.ring) {
      cx += this.pts[i].x;
      cy += this.pts[i].y;
    }
    cx /= this.ring.length;
    cy /= this.ring.length;

    ctx.beginPath();
    this.ring.forEach((index, n) => {
      const p = this.pts[index];
      const x = cx + (p.x - cx) * inflate;
      const y = cy + (p.y - cy) * inflate;
      if (n === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}
