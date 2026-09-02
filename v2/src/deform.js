import { CONFIG } from './config.js';

// A displacement field held in the head's own frame, which is what keeps a
// dent where the visitor put it while they move around. Values are in
// eye-distance units; the shader converts them back to screen space.
export class Deform {
  constructor() {
    this.size = CONFIG.deformGrid;
    this.field = new Float32Array(this.size * this.size * 2);
    this.bytes = new Uint8Array(this.size * this.size * 2);
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

  // (u, v) is the hand's position across the field, (dx, dy) the distance it
  // moved in eye-distances. The stored offset is the negation of the motion:
  // pulling content from behind the hand is what makes the surface follow it.
  push(u, v, dx, dy, radiusUnits) {
    const max = CONFIG.deformStrength;
    const r = (radiusUnits / CONFIG.faceExtent) * this.size;
    const cx = u * this.size;
    const cy = v * this.size;

    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.size - 1, Math.ceil(cy + r));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x - cx) / r;
        const ny = (y - cy) / r;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const fall = (1 - d2) ** 2;
        const i = (y * this.size + x) * 2;
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
