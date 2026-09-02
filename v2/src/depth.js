import { CONFIG } from './config.js';

const NASION = 168;
// 0..467 are the mesh; the iris points that follow would drag the surface
// around with the gaze.
const MESH_COUNT = 468;

// A depth map of the face, in the head's own frame, built from the landmark
// z values.
//
// This exists because lighting the paint from the camera image alone fails
// exactly where it matters: a frontally lit face has almost no luminance
// gradient, so the coat came out flat there while it looked convincing on a
// shirt full of folds. Real geometry does not care how the room is lit.
export class FaceDepth {
  constructor() {
    this.size = CONFIG.depthGrid;
    const n = this.size * this.size;
    this.val = new Float32Array(n);
    this.cov = new Float32Array(n);
    this.acc = new Float32Array(n);
    this.wgt = new Float32Array(n);
    this.tmpV = new Float32Array(n);
    this.tmpC = new Float32Array(n);
    this.bytes = new Uint8Array(n * 4);
    this.ready = false;
  }

  update(face) {
    if (!face.present || !face.pts) { this.ready = false; return; }

    const S = this.size;
    const e = CONFIG.faceExtent;
    const originZ = face.pts[NASION].z;
    const R = 2.4;

    this.acc.fill(0);
    this.wgt.fill(0);

    for (let i = 0; i < MESH_COUNT; i++) {
      const p = face.pts[i];
      const dx = p.x - face.origin.x;
      const dy = p.y - face.origin.y;
      const fx = (dx * face.axisU.x + dy * face.axisU.y) / face.scale;
      const fy = (dx * face.axisV.x + dy * face.axisV.y) / face.scale;
      // Towards the camera is up, so the nose is a hill rather than a pit.
      const fz = -(p.z - originZ) / face.scale;

      const gx = (CONFIG.faceCentre.x + fx / e) * S;
      const gy = (CONFIG.faceCentre.y + fy / e) * S;

      const x0 = Math.max(0, Math.floor(gx - R));
      const x1 = Math.min(S - 1, Math.ceil(gx + R));
      const y0 = Math.max(0, Math.floor(gy - R));
      const y1 = Math.min(S - 1, Math.ceil(gy + R));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d2 = (x + 0.5 - gx) ** 2 + (y + 0.5 - gy) ** 2;
          if (d2 > R * R) continue;
          const w = Math.exp(-d2 / 1.8);
          const k = y * S + x;
          this.acc[k] += fz * w;
          this.wgt[k] += w;
        }
      }
    }

    for (let k = 0; k < this.val.length; k++) {
      if (this.wgt[k] > 1e-4) {
        this.val[k] = this.acc[k] / this.wgt[k];
        this.cov[k] = 1;
      } else {
        this.val[k] = 0;
        this.cov[k] = 0;
      }
    }

    // The landmarks are a scatter, not a surface: grow the covered area a
    // little to close the gaps, then smooth so the gradient is usable.
    this.#dilate(3);
    this.#smooth(3);
    this.ready = true;
  }

  #dilate(passes) {
    const S = this.size;
    for (let pass = 0; pass < passes; pass++) {
      this.tmpV.set(this.val);
      this.tmpC.set(this.cov);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const k = y * S + x;
          if (this.cov[k] > 0) continue;
          let sum = 0;
          let w = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const nx = x + i;
              const ny = y + j;
              if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
              const m = ny * S + nx;
              if (this.cov[m] <= 0) continue;
              sum += this.val[m] * this.cov[m];
              w += this.cov[m];
            }
          }
          if (w > 0) {
            this.tmpV[k] = sum / w;
            this.tmpC[k] = Math.min(0.75, w / 8) * 0.8;
          }
        }
      }
      this.val.set(this.tmpV);
      this.cov.set(this.tmpC);
    }
  }

  #smooth(passes) {
    const S = this.size;
    for (let pass = 0; pass < passes; pass++) {
      this.tmpV.set(this.val);
      this.tmpC.set(this.cov);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          let sum = 0;
          let csum = 0;
          let w = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const nx = Math.min(S - 1, Math.max(0, x + i));
              const ny = Math.min(S - 1, Math.max(0, y + j));
              const m = ny * S + nx;
              const cw = Math.max(0.02, this.cov[m]);
              sum += this.val[m] * cw;
              csum += this.cov[m];
              w += cw;
            }
          }
          const k = y * S + x;
          this.tmpV[k] = sum / w;
          this.tmpC[k] = csum / 9;
        }
      }
      this.val.set(this.tmpV);
      this.cov.set(this.tmpC);
    }
  }

  // RG hold the slope of the surface, B how much of it came from real
  // landmarks. The shader turns the slope into a normal.
  pack() {
    const S = this.size;
    const cell = CONFIG.faceExtent / S;   // face units per cell
    const range = CONFIG.depthRange;

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        const xm = this.val[y * S + Math.max(0, x - 1)];
        const xp = this.val[y * S + Math.min(S - 1, x + 1)];
        const ym = this.val[Math.max(0, y - 1) * S + x];
        const yp = this.val[Math.min(S - 1, y + 1) * S + x];

        this.bytes[k * 4] = byte(((xp - xm) / (2 * cell)) / range);
        this.bytes[k * 4 + 1] = byte(((yp - ym) / (2 * cell)) / range);
        this.bytes[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, this.cov[k])) * 255);
        this.bytes[k * 4 + 3] = 255;
      }
    }
    return this.bytes;
  }
}

function byte(v) {
  return Math.round(Math.min(1, Math.max(0, v * 0.5 + 0.5)) * 255);
}
