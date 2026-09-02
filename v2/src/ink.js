import { CONFIG } from './config.js';

const SPRITE = 64;
const SPRITE_CACHE_LIMIT = 192;
const PROBE = 128;

// The paint layer. Because it lives in the head's own frame it is
// append-only: marks accumulate, runs keep crawling after the hand has gone,
// and nothing is ever re-resolved.
//
// Marks are stamped, not drawn as shapes. Soft stamps make the masses, whose
// falloff is what the shader reads as thickness; hard little ones make the
// spatter. A mark also picks up whatever colour it lands in, and fresh paint
// keeps creeping into itself until it sets.
export class Ink {
  constructor(width, height) {
    this.canvas = make(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.scratch = make(width, height);

    // A cheap, coarse copy of the layer, so a brush can ask what colour is
    // already underneath it without stalling the pipeline on a readback.
    this.probe = make(PROBE, PROBE);
    this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
    this.probeData = null;

    this.runs = [];
    this.sprites = new Map();
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
    this.probeData = null;
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

  // --- stamps --------------------------------------------------------------

  #sprite(color, hard) {
    const key = (hard ? 'h' : 's') + color;
    let b = this.sprites.get(key);
    if (b) return b;
    // Mixing invents colours, so the cache is bounded rather than unbounded.
    if (this.sprites.size > SPRITE_CACHE_LIMIT) this.sprites.clear();

    const R = SPRITE / 2;
    b = make(SPRITE, SPRITE);
    const ctx = b.getContext('2d');
    const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
    if (hard) {
      grad.addColorStop(0, color);
      grad.addColorStop(0.74, color);
      grad.addColorStop(0.92, rgba(color, 0.7));
      grad.addColorStop(1, rgba(color, 0));
    } else {
      grad.addColorStop(0, color);
      grad.addColorStop(0.6, color);
      grad.addColorStop(0.85, rgba(color, 0.55));
      grad.addColorStop(1, rgba(color, 0));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SPRITE, SPRITE);
    this.sprites.set(key, b);
    return b;
  }

  #stamp(x, y, r, color, { alpha = 1, hard = false, ang = 0, stretch = 1 } = {}) {
    const ctx = this.ctx;
    // A sprite's falloff eats anything this small, leaving specks too faint
    // to see. Below the threshold a mark is drawn outright.
    if (r < CONFIG.speckRadius) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (stretch === 1) {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else {
        ctx.ellipse(x, y, r * stretch, r, ang, 0, Math.PI * 2);
      }
      ctx.fill();
      return;
    }

    const b = this.#sprite(color, hard);
    ctx.globalAlpha = alpha;
    if (stretch === 1) {
      ctx.drawImage(b, x - r, y - r, r * 2, r * 2);
      return;
    }
    // Droplets thrown hard are streaks, not dots.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(stretch, 1);
    ctx.drawImage(b, -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  // --- wet-on-wet ----------------------------------------------------------

  #refreshProbe() {
    const ctx = this.probeCtx;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.canvas, 0, 0, PROBE, PROBE);
    ctx.globalCompositeOperation = 'source-over';
    this.probeData = ctx.getImageData(0, 0, PROBE, PROBE);
  }

  // The colour a mark ends up as: its own, pulled towards whatever it landed
  // in. Quantised, because every distinct result costs a cached sprite.
  #tint(color, x, y) {
    const d = this.probeData;
    if (!d) return color;
    const px = clampIndex((x / this.canvas.width) * PROBE, PROBE);
    const py = clampIndex((y / this.canvas.height) * PROBE, PROBE);
    const i = (py * PROBE + px) * 4;
    const a = d.data[i + 3] / 255;
    if (a < 0.06) return color;

    const c = parseInt(color.slice(1), 16);
    const t = CONFIG.pickup * a;
    // Averaging how much each channel absorbs, not how much it reflects.
    // Quantised on the way out: every distinct result costs a cached sprite.
    const e = CONFIG.mixFloor;
    const mix = (own, under) => {
      const dm = -Math.log(own / 255 + e) * (1 - t) - Math.log(under / 255 + e) * t;
      return Math.round(Math.min(255, Math.max(0, (Math.exp(-dm) - e) * 255)) / 8) * 8;
    };
    const r = mix((c >> 16) & 255, d.data[i]);
    const g = mix((c >> 8) & 255, d.data[i + 1]);
    const b = mix(c & 255, d.data[i + 2]);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  // --- marks ---------------------------------------------------------------

  // A thrown blot, in the Pollock sense: a small body and a long fan of
  // droplets, most of them tiny, a few fat, the fast ones drawn out into
  // streaks along the throw.
  splat(x, y, color, size, dir = null) {
    const r = this.rand;
    const speed = dir ? Math.min(1, Math.hypot(dir.x, dir.y) / 40) : 0;
    const ang = dir && speed > 0.05 ? Math.atan2(dir.y, dir.x) : r() * Math.PI * 2;
    const c = this.#tint(color, x, y);

    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * size * 0.34;
      this.#stamp(x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.16 + r() * 0.2), c);
    }

    const count = Math.round((120 + r() * 120) * CONFIG.spatter);
    for (let i = 0; i < count; i++) {
      const t = Math.pow(r(), 0.55);
      const d = size * (0.4 + t * (3.2 + speed * 7));
      const lat = (r() - 0.5) * size * (0.4 + t * 1.9) * (speed > 0.05 ? 1.15 : 3.4);
      const px = x + Math.cos(ang) * d - Math.sin(ang) * lat;
      const py = y + Math.sin(ang) * d + Math.cos(ang) * lat;
      // A power law, so the fan is mostly specks with the odd fat drop.
      const rad = Math.max(1.1, size * 0.014 * (1 + Math.pow(r(), 4) * 14));
      this.#stamp(px, py, rad, c, {
        hard: true, alpha: 0.75 + r() * 0.25,
        ang, stretch: 1 + t * speed * 2.4,
      });
    }

    const whips = 1 + Math.floor(r() * 3);
    for (let i = 0; i < whips; i++) {
      this.#whip(x, y, ang + (r() - 0.5) * 1.1, size * (2.5 + r() * 5), size * 0.09, c);
    }

    const runs = 1 + Math.floor(r() * 2);
    for (let i = 0; i < runs; i++) {
      this.#run(x + (r() - 0.5) * size * 1.1, y + size * 0.6, c,
        size * (0.11 + r() * 0.15), size * (1.6 + r() * 4));
    }
    this.#wetten();
  }

  // The flicked line a loaded brush leaves: thinning, wandering, breaking up.
  #whip(x, y, ang, len, width, color) {
    const r = this.rand;
    const steps = Math.round(24 + r() * 34);
    const step = len / steps;
    let a = ang;
    const curve = (r() - 0.5) * 0.06;
    let px = x;
    let py = y;
    for (let i = 0; i < steps; i++) {
      a += curve;
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      if (r() < 0.12) continue;              // the line breaks up as it goes
      const rad = Math.max(0.9, width * (1 - i / steps) * (0.45 + r() * 0.9));
      this.#stamp(px, py, rad, color, { hard: true, alpha: 0.85 });
    }
  }

  // A bucket emptied over the head: a broad sheet that coats, a curtain of
  // runs off its lower edge, and a haze of spray around the impact.
  pour(x, y, color, size) {
    const r = this.rand;
    const c = this.#tint(color, x, y);
    const w = size * 2.1;

    for (let i = 0; i < 14; i++) {
      this.#stamp(x + (r() - 0.5) * w, y + (r() - 0.5) * size * 0.7,
        size * (0.5 + r() * 0.55), c);
    }

    const specks = Math.round(140 * CONFIG.spatter);
    for (let i = 0; i < specks; i++) {
      const a = r() * Math.PI * 2;
      const d = size * (0.9 + Math.pow(r(), 0.6) * 2.6);
      this.#stamp(x + Math.cos(a) * d, y + Math.sin(a) * d,
        Math.max(1, size * 0.012 * (1 + Math.pow(r(), 4) * 12)), c,
        { hard: true, alpha: 0.7 + r() * 0.3 });
    }

    const count = 4 + Math.floor(r() * 5);
    for (let i = 0; i < count; i++) {
      this.#run(x + (r() - 0.5) * w, y + size * 0.5, c,
        size * (0.11 + r() * 0.22), this.canvas.height * (0.16 + r() * 0.34));
    }
    this.#wetten();
  }

  // A continuous coat, stamped densely enough to read as one mass, throwing
  // a little spray off the leading edge.
  strokeTo(from, to, color, size) {
    const r = this.rand;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const steps = Math.max(1, Math.ceil(len / (size * 0.22)));
    const c = this.#tint(color, to.x, to.y);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.#stamp(from.x + dx * t, from.y + dy * t, size * (0.48 + r() * 0.06), c);
    }

    const specks = Math.round((3 + len * 0.11) * CONFIG.spatter);
    for (let i = 0; i < specks; i++) {
      const t = r();
      const off = (r() - 0.5) * size * 2.4;
      this.#stamp(
        from.x + dx * t - Math.sin(ang) * off,
        from.y + dy * t + Math.cos(ang) * off,
        Math.max(0.9, size * 0.02 * (1 + Math.pow(r(), 4) * 9)), c,
        { hard: true, alpha: 0.6 + r() * 0.4 },
      );
    }

    if (r() < 0.09) {
      this.#run(to.x, to.y + size * 0.45, c, size * (0.11 + r() * 0.16), size * (1.4 + r() * 4));
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

  #wetten() {
    this.wet = Math.min(26, this.wet + 12);
    this.dirty = true;
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
      // Running paint keeps the layer damp, but no longer pins it open: once
      // the runs stall, the coat sets.
      this.wet = Math.max(this.wet, 5);
    }

    this.#bleed();
    this.ctx.globalAlpha = 1;
  }

  // Wet paint keeps moving into itself for a while, then sets. Each pass is a
  // small diffusion of the whole layer, which softens edges and lets
  // neighbouring colours run together instead of stacking as flat decals.
  // The same beat refreshes the probe the brushes read for pickup.
  #bleed() {
    if (this.tick % CONFIG.bleedEveryNFrames !== 0) return;
    this.#refreshProbe();
    if (this.wet <= 0) return;
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

function clampIndex(v, size) {
  return Math.min(size - 1, Math.max(0, Math.round(v)));
}

function rgba(hex, a) {
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
