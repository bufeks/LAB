import { CONFIG } from './config.js';

// The paint layer. Because it lives in the head's own frame it is
// append-only: marks accumulate, runs keep crawling after the hand has gone,
// and nothing is ever re-resolved.
//
// Everything is laid down with soft-edged stamps rather than hard shapes. The
// falloff is what lets colours bleed into one another where they overlap, and
// it is also what the shader reads as thickness when it lights the surface.
export class Ink {
  constructor(width, height) {
    this.canvas = make(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.scratch = make(width, height);
    this.runs = [];
    this.brushes = new Map();
    this.wet = 0;
    this.tick = 0;
    this.dirty = true;
    this.rand = mulberry32(0x5eed);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.runs.length = 0;
    this.wet = 0;
    this.dirty = true;
  }

  snapshot() {
    const c = make(this.canvas.width, this.canvas.height);
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return { image: c, runs: this.runs.map((r) => ({ ...r })) };
  }

  restore(snap) {
    this.clear();
    this.ctx.drawImage(snap.image, 0, 0);
    this.runs = snap.runs.map((r) => ({ ...r }));
    this.dirty = true;
  }

  // A soft disc in one colour, rendered once and reused. The plateau keeps
  // the middle opaque so a mass reads as a coat, while the falloff gives the
  // wet edge the lighting needs.
  #brush(color) {
    let b = this.brushes.get(color);
    if (b) return b;
    const R = 96;
    b = make(R * 2, R * 2);
    const ctx = b.getContext('2d');
    const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, color);
    grad.addColorStop(0.62, color);
    grad.addColorStop(0.86, hexA(color, 0.55));
    grad.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, R * 2, R * 2);
    this.brushes.set(color, b);
    return b;
  }

  #stamp(x, y, r, color, alpha = 1) {
    const b = this.#brush(color);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(b, x - r, y - r, r * 2, r * 2);
  }

  #wetten() {
    this.wet = Math.min(26, this.wet + 12);
    this.dirty = true;
  }

  // A thrown blot: a body of overlapping soft masses, a scatter of satellites
  // thrown further along the travel, and a couple of runs starting from the
  // bottom of the mass.
  splat(x, y, color, size, dir = null) {
    const r = this.rand;
    const speed = dir ? Math.min(1, Math.hypot(dir.x, dir.y) / 40) : 0;
    const ang = dir && speed > 0.05 ? Math.atan2(dir.y, dir.x) : r() * Math.PI * 2;

    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * size * 0.4;
      this.#stamp(
        x + Math.cos(a) * d + Math.cos(ang) * speed * size * 0.35,
        y + Math.sin(a) * d + Math.sin(ang) * speed * size * 0.35,
        size * (0.34 + r() * 0.4), color,
      );
    }

    const count = 6 + Math.floor(r() * 9);
    for (let i = 0; i < count; i++) {
      const spread = speed > 0.05 ? 1.0 : Math.PI * 2;
      const a = ang + (r() - 0.5) * spread;
      const d = size * (0.8 + r() * (2.2 + speed * 3));
      this.#stamp(x + Math.cos(a) * d, y + Math.sin(a) * d,
        size * 0.07 * (0.5 + r() * 1.8), color, 0.85);
    }

    const runs = 1 + Math.floor(r() * 2);
    for (let i = 0; i < runs; i++) {
      this.#run(x + (r() - 0.5) * size * 1.1, y + size * 0.7, color,
        size * (0.13 + r() * 0.16), size * (1.6 + r() * 4));
    }
    this.#wetten();
  }

  // A bucket emptied over the head: a broad sheet that coats, and a curtain
  // of runs off its lower edge.
  pour(x, y, color, size) {
    const r = this.rand;
    const w = size * 2.1;
    for (let i = 0; i < 14; i++) {
      this.#stamp(x + (r() - 0.5) * w, y + (r() - 0.5) * size * 0.7,
        size * (0.5 + r() * 0.55), color);
    }
    const count = 4 + Math.floor(r() * 5);
    for (let i = 0; i < count; i++) {
      this.#run(x + (r() - 0.5) * w, y + size * 0.5, color,
        size * (0.11 + r() * 0.22), this.canvas.height * (0.16 + r() * 0.34));
    }
    this.#wetten();
  }

  // A continuous coat, stamped densely enough that the strokes read as one
  // mass rather than a row of dots.
  strokeTo(from, to, color, size) {
    const r = this.rand;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / (size * 0.22)));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.#stamp(from.x + dx * t, from.y + dy * t, size * (0.48 + r() * 0.06), color);
    }
    if (r() < 0.09) {
      this.#run(to.x, to.y + size * 0.45, color, size * (0.11 + r() * 0.16), size * (1.4 + r() * 4));
    }
    this.#wetten();
  }

  #run(x, y, color, width, length) {
    this.runs.push({
      x, y, color,
      w: Math.max(1.5, width),
      travelled: 0,
      length,
      speed: 22 + this.rand() * 80,
      // A run never falls dead straight; the wobble is what makes it read as
      // liquid finding its way rather than a drawn line.
      phase: this.rand() * Math.PI * 2,
      wobble: width * (0.5 + this.rand() * 1.4),
    });
  }

  // Runs are drawn incrementally: each frame lays down the stretch covered
  // since the last one, so the trail is the drawing.
  update(dt) {
    this.tick++;
    if (this.runs.length) {
      for (const run of this.runs) {
        const step = Math.min(run.speed * dt, run.length - run.travelled);
        if (step <= 0) { run.done = true; continue; }

        const from = run.travelled;
        const to = from + step;
        const p = from / run.length;
        // A run thins as it goes but keeps a fat head of wet paint.
        const w = run.w * (1 - p * 0.55);
        const stamps = Math.max(1, Math.ceil(step / (w * 0.5)));

        for (let i = 1; i <= stamps; i++) {
          const d = from + (step * i) / stamps;
          const x = run.x + Math.sin(d * 0.035 + run.phase) * run.wobble;
          this.#stamp(x, run.y + d, w, run.color);
        }

        const headX = run.x + Math.sin(to * 0.035 + run.phase) * run.wobble;
        this.#stamp(headX, run.y + to, w * 1.25, run.color);

        run.travelled = to;
        // Gravity pulls, surface tension holds it back; it always stalls.
        run.speed *= 0.985;
        if (run.travelled >= run.length || run.speed < 3
            || run.y + to > this.canvas.height + 20) {
          // The pendant drop left hanging at the end.
          this.#stamp(headX, run.y + to + w * 0.4, w * 1.7, run.color);
          run.done = true;
        }
      }
      if (this.runs.some((r) => r.done)) this.runs = this.runs.filter((r) => !r.done);
      this.dirty = true;
      // Running paint keeps the layer damp, but it no longer pins it open:
      // once the runs stall, the coat sets.
      this.wet = Math.max(this.wet, 5);
    }

    this.#bleed();
    this.ctx.globalAlpha = 1;
  }

  // Wet paint keeps moving into itself for a while, then sets. Each pass is a
  // small diffusion of the whole layer, which is what softens edges and lets
  // neighbouring colours run together instead of stacking as flat decals.
  #bleed() {
    if (this.wet <= 0 || this.tick % CONFIG.bleedEveryNFrames !== 0) return;
    this.wet--;

    const s = this.scratch;
    const sctx = s.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'copy';
    sctx.filter = `blur(${CONFIG.bleedRadius}px)`;
    sctx.drawImage(this.canvas, 0, 0);
    sctx.filter = 'none';

    this.ctx.globalCompositeOperation = 'copy';
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(s, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
    this.dirty = true;
  }
}

function make(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
