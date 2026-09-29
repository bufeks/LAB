// Shared bits for the two strategy stages (tribe, civilization):
// box selection and simple unit separation.

import { game } from './game.js';

export class Selector {
  constructor() { this.box = null; }

  // Returns true if the input was consumed as a selection.
  update(cam, units, selected) {
    const inp = game.input;
    const d = inp.drag;
    this.box = d && !d.touch && Math.hypot(d.x - d.x0, d.y - d.y0) > 8 ? d : null;
    const e = inp.dragEnd;
    if (e && !e.touch) {
      const a = cam.toWorld(Math.min(e.x0, e.x), Math.min(e.y0, e.y));
      const b = cam.toWorld(Math.max(e.x0, e.x), Math.max(e.y0, e.y));
      if (!inp.isDown('ShiftLeft', 'ShiftRight')) selected.clear();
      for (const u of units) if (u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) selected.add(u);
      return true;
    }
    return false;
  }

  draw(ctx) {
    const b = this.box;
    if (!b) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,255,160,0.9)';
    ctx.fillStyle = 'rgba(160,255,160,0.12)';
    ctx.lineWidth = 1.5;
    const x = Math.min(b.x0, b.x), y = Math.min(b.y0, b.y), w = Math.abs(b.x - b.x0), h = Math.abs(b.y - b.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

// Push overlapping units apart (O(n^2) is fine for a few dozen units).
export function separate(units, dt, isOk) {
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const min = (a.r + b.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5 * Math.min(1, dt * 10);
        const nx = dx / d, ny = dy / d;
        const ax = a.x - nx * push, ay = a.y - ny * push, bx = b.x + nx * push, by = b.y + ny * push;
        if (!isOk || isOk(ax, ay)) { a.x = ax; a.y = ay; }
        if (!isOk || isOk(bx, by)) { b.x = bx; b.y = by; }
      }
    }
  }
}

export function drawBar(ctx, x, y, w, f, col) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = col || (f > 0.5 ? '#6f6' : f > 0.25 ? '#fd4' : '#f55');
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, f)), 5);
}
