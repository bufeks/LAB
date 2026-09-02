import { CONFIG } from './config.js';

const SPRAY_DOTS = 5;

// Stores strokes as points anchored to the face, and repaints them into an
// offscreen layer every frame so they track the head.
export class Painter {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.strokes = [];
    this.active = new Map();  // painter id -> stroke list for this gesture
    this.group = 0;
    this._p = { x: 0, y: 0 };
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  begin(id, face, opts) {
    this.end(id);
    const group = ++this.group;
    const make = () => {
      const stroke = {
        group,
        color: opts.color,
        size: opts.size,
        style: opts.style,
        erase: opts.erase,
        refScale: face.frame.s,
        points: [],
        last: null,
      };
      this.strokes.push(stroke);
      return stroke;
    };

    const strokes = [make()];
    if (opts.symmetry && !opts.erase) strokes.push(make());
    this.active.set(id, strokes);
  }

  extend(id, x, y, face) {
    const strokes = this.active.get(id);
    if (!strokes || !face.present) return;

    strokes.forEach((stroke, n) => {
      const p = n === 0 ? { x, y } : face.reflect(x, y);
      if (stroke.last) {
        const d = Math.hypot(p.x - stroke.last.x, p.y - stroke.last.y);
        if (d < CONFIG.minSampleDistance) return;
      }
      stroke.last = p;

      if (stroke.style === 'spray') {
        const r = stroke.size * 1.4;
        for (let i = 0; i < SPRAY_DOTS; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * r;
          stroke.points.push(face.anchorsFor(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d));
        }
      } else {
        stroke.points.push(face.anchorsFor(p.x, p.y));
      }
    });
  }

  end(id) {
    const strokes = this.active.get(id);
    if (!strokes) return;
    // Drop gestures that never produced a mark, so undo stays meaningful.
    for (const stroke of strokes) {
      if (stroke.points.length === 0) {
        const at = this.strokes.indexOf(stroke);
        if (at !== -1) this.strokes.splice(at, 1);
      }
    }
    this.active.delete(id);
  }

  isPainting(id) {
    return this.active.has(id);
  }

  undo() {
    if (this.strokes.length === 0) return;
    const group = this.strokes[this.strokes.length - 1].group;
    while (this.strokes.length && this.strokes[this.strokes.length - 1].group === group) {
      this.strokes.pop();
    }
    for (const [id, strokes] of this.active) {
      if (strokes[0].group === group) this.active.delete(id);
    }
  }

  clear() {
    this.strokes.length = 0;
    this.active.clear();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(face) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!face.present) return;

    for (const stroke of this.strokes) {
      if (stroke.points.length === 0) continue;
      const scale = face.frame.s / stroke.refScale;
      const width = stroke.size * scale;

      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.style === 'spray' && !stroke.erase) {
        this.#drawSpray(stroke, face, width);
      } else if (stroke.style === 'neon' && !stroke.erase) {
        this.#drawPath(stroke, face);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = width * 3;
        ctx.stroke();
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = width * 1.5;
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = Math.max(1, width * 0.4);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        this.#drawPath(stroke, face);
        ctx.globalAlpha = stroke.erase ? 1 : 0.92;
        ctx.lineWidth = stroke.erase ? width * 1.2 : width;
        ctx.strokeStyle = stroke.color;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  #drawPath(stroke, face) {
    const ctx = this.ctx;
    ctx.beginPath();
    stroke.points.forEach((anchors, n) => {
      const p = face.resolve(anchors, this._p);
      if (n === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    // A single tap should still leave a dot rather than an empty path.
    if (stroke.points.length === 1) {
      const p = face.resolve(stroke.points[0], this._p);
      ctx.lineTo(p.x + 0.01, p.y);
    }
  }

  #drawSpray(stroke, face, width) {
    const ctx = this.ctx;
    const r = Math.max(0.6, width * 0.16);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    for (const anchors of stroke.points) {
      const p = face.resolve(anchors, this._p);
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}
