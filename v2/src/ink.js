// The ink layer. Because the bust is a still image, ink is append-only:
// nothing is ever re-resolved, marks simply accumulate and runs keep
// crawling downwards after the hand has moved on.
export class Ink {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.runs = [];
    this.dirty = true;
    this.rand = mulberry32(0x5eed);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.runs.length = 0;
    this.dirty = true;
  }

  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return { image: c, runs: this.runs.map((r) => ({ ...r })) };
  }

  restore(snap) {
    this.clear();
    this.ctx.drawImage(snap.image, 0, 0);
    this.runs = snap.runs.map((r) => ({ ...r }));
    this.dirty = true;
  }

  // A thrown blot: an irregular body, a ring of satellites, and a few runs
  // that start crawling immediately. `dir` elongates it along the throw.
  splat(x, y, color, size, dir = null) {
    const ctx = this.ctx;
    const r = this.rand;
    const speed = dir ? Math.min(1, Math.hypot(dir.x, dir.y) / 40) : 0;
    const ang = dir && speed > 0.05 ? Math.atan2(dir.y, dir.x) : r() * Math.PI * 2;

    ctx.fillStyle = color;
    ctx.globalAlpha = 1;

    // Body: overlapping ellipses, stretched along the throw direction.
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * size * 0.42;
      const rx = size * (0.3 + r() * 0.42) * (1 + speed * 0.8);
      const ry = size * (0.3 + r() * 0.42);
      ctx.save();
      ctx.translate(x + Math.cos(a) * d + Math.cos(ang) * speed * size * 0.35,
                    y + Math.sin(a) * d + Math.sin(ang) * speed * size * 0.35);
      ctx.rotate(ang + (r() - 0.5) * 0.8);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Satellites, thrown further along the direction of travel.
    const count = 14 + Math.floor(r() * 18);
    for (let i = 0; i < count; i++) {
      const spread = dir && speed > 0.05 ? 1.1 : Math.PI * 2;
      const a = ang + (r() - 0.5) * spread;
      const d = size * (0.7 + r() * (2.4 + speed * 3));
      const rr = size * 0.05 * (0.3 + r() * 1.5);
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, rr * (1 + speed), rr, a, 0, Math.PI * 2);
      ctx.fill();
    }

    const runs = 1 + Math.floor(r() * 3);
    for (let i = 0; i < runs; i++) {
      this.#run(x + (r() - 0.5) * size * 1.2, y + size * 0.4, color,
                size * (0.10 + r() * 0.16), size * (2 + r() * 7));
    }
    this.dirty = true;
  }

  // A bucket emptied over the head: a wide pool that spawns a curtain of runs.
  pour(x, y, color, size) {
    const r = this.rand;
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    const w = size * 2.2;
    for (let i = 0; i < 16; i++) {
      const px = x + (r() - 0.5) * w;
      const py = y + (r() - 0.5) * size * 0.5;
      ctx.beginPath();
      ctx.ellipse(px, py, size * (0.35 + r() * 0.5), size * (0.25 + r() * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const count = 7 + Math.floor(r() * 7);
    for (let i = 0; i < count; i++) {
      this.#run(x + (r() - 0.5) * w, y + size * 0.3, color,
                size * (0.08 + r() * 0.22), this.canvas.height * (0.3 + r() * 0.8));
    }
    this.dirty = true;
  }

  // Continuous stroke, with a little spatter so it never looks like a
  // vector line.
  strokeTo(from, to, color, size) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    const r = this.rand;
    if (r() < 0.25) {
      const a = r() * Math.PI * 2;
      const d = size * (0.6 + r() * 1.4);
      ctx.beginPath();
      ctx.arc(to.x + Math.cos(a) * d, to.y + Math.sin(a) * d, size * 0.06 * (1 + r() * 2), 0, Math.PI * 2);
      ctx.fill();
    }
    if (r() < 0.06) {
      this.#run(to.x, to.y, color, size * (0.1 + r() * 0.2), size * (1.5 + r() * 6));
    }
    ctx.globalAlpha = 1;
    this.dirty = true;
  }

  #run(x, y, color, width, length) {
    this.runs.push({
      x, y, color,
      w: Math.max(1.2, width),
      travelled: 0,
      length,
      speed: 26 + this.rand() * 90,
    });
  }

  // Runs are drawn incrementally: each frame lays down the segment covered
  // since the last one, so the trail is the drawing.
  update(dt) {
    if (this.runs.length === 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';

    for (const run of this.runs) {
      const step = Math.min(run.speed * dt, run.length - run.travelled);
      if (step <= 0) { run.done = true; continue; }

      const y0 = run.y + run.travelled;
      const y1 = y0 + step;
      const p = run.travelled / run.length;
      const w = run.w * (1 - p * 0.65);

      ctx.strokeStyle = run.color;
      ctx.lineWidth = Math.max(0.8, w);
      ctx.beginPath();
      ctx.moveTo(run.x, y0);
      ctx.lineTo(run.x, y1);
      ctx.stroke();

      // The bead of wet ink at the tip.
      ctx.fillStyle = run.color;
      ctx.beginPath();
      ctx.arc(run.x, y1, Math.max(0.8, w * 0.62), 0, Math.PI * 2);
      ctx.fill();

      run.travelled += step;
      // Gravity pulls, surface tension holds it back; it always stalls.
      run.speed *= 0.985;
      if (run.travelled >= run.length || run.speed < 3 || y1 > this.canvas.height + 20) {
        run.done = true;
      }
    }

    const before = this.runs.length;
    this.runs = this.runs.filter((r) => !r.done);
    if (before !== this.runs.length || before > 0) this.dirty = true;
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
