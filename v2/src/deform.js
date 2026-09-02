import { CONFIG } from './config.js';

// A displacement field in UV space. The shader samples the portrait at
// uv + displacement, so pushing a region shifts the surface like soft clay
// and, crucially, drags the ink already sitting on it along too.
export class Deform {
  constructor() {
    this.w = CONFIG.deformGrid.w;
    this.h = CONFIG.deformGrid.h;
    this.field = new Float32Array(this.w * this.h * 2);
    this.bytes = new Uint8Array(this.w * this.h * 2);
    this.dirty = true;
  }

  clear() {
    this.field.fill(0);
    this.dirty = true;
  }

  snapshot() {
    return Float32Array.from(this.field);
  }

  restore(snap) {
    this.field.set(snap);
    this.dirty = true;
  }

  // (ux, uy) is where the hand is, (dx, dy) how far it moved, both in UV.
  // The sample offset is the negative of the motion: pulling content from
  // behind the hand is what makes the surface follow it.
  push(ux, uy, dx, dy, radius = CONFIG.deformRadius) {
    const max = CONFIG.deformStrength;
    const rx = radius * this.w;
    const ry = radius * this.h;
    const cx = ux * this.w;
    const cy = uy * this.h;

    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const fall = (1 - d2) ** 2;
        const i = (y * this.w + x) * 2;
        this.field[i] = clamp(this.field[i] - dx * fall, -max, max);
        this.field[i + 1] = clamp(this.field[i + 1] - dy * fall, -max, max);
      }
    }
    this.dirty = true;
  }

  // Packed into RG8; linear filtering on the GPU smooths the quantisation
  // back out, and the field is broad and soft to begin with.
  pack() {
    const max = CONFIG.deformStrength;
    for (let i = 0; i < this.field.length; i++) {
      this.bytes[i] = Math.round(((this.field[i] / max) * 0.5 + 0.5) * 255);
    }
    this.dirty = false;
    return this.bytes;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
