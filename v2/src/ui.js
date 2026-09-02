import { CONFIG } from './config.js';

const TOOLS = [
  { id: 'tool:break', label: 'BREAK', sub: '歪ませる' },
  { id: 'tool:ink', label: 'INK', sub: 'ぶつける' },
  { id: 'tool:paint', label: 'PAINT', sub: '塗る' },
  { id: 'tool:pour', label: 'POUR', sub: 'ぶちまける' },
];

const ACTIONS = [
  { id: 'undo', label: 'UNDO', sub: '戻す' },
  { id: 'reset', label: 'RESET', sub: '戻す(全)' },
  { id: 'done', label: 'DONE', sub: '完成' },
];

// The rail is drawn onto the HUD canvas so that one hit-test serves both a
// pinching hand and a mouse, exactly as in v1.
export class UI {
  constructor() {
    this.hotspots = [];
    this.visible = true;
  }

  layout(width, height) {
    const spots = [];
    const r = Math.max(13, Math.round(height * 0.029));
    const gap = r * 2.7;
    const x = r * 2.1;
    const top = (height - gap * (CONFIG.palette.length - 1)) / 2;

    CONFIG.palette.forEach((c, i) => {
      spots.push({ id: `color:${i}`, kind: 'circle', x, y: top + gap * i, r, color: c.hex });
    });

    const h = Math.max(44, Math.round(height * 0.086));
    const y = height - h - Math.round(height * 0.04);
    this.title = Math.round(h * 0.30);
    this.sub = Math.round(h * 0.20);

    let cursor = x - r;
    const put = (item, w) => {
      spots.push({ ...item, kind: 'rect', x: cursor, y, w, h });
      cursor += w + Math.round(h * 0.16);
    };

    for (const t of TOOLS) put(t, Math.round(h * 2.05));
    cursor += Math.round(h * 0.34);
    ['S', 'M', 'L'].forEach((label, i) => put({ id: `size:${i}`, label }, Math.round(h * 0.78)));
    cursor += Math.round(h * 0.34);
    for (const a of ACTIONS) put(a, Math.round(h * 1.5));

    this.hotspots = spots;
  }

  hitTest(x, y) {
    if (!this.visible) return null;
    for (const s of this.hotspots) {
      if (s.kind === 'circle') {
        if ((x - s.x) ** 2 + (y - s.y) ** 2 <= (s.r * 1.4) ** 2) return s.id;
      } else if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        return s.id;
      }
    }
    return null;
  }

  // Returns an action name for one-shot buttons, or null when it only
  // changed the current state.
  activate(id, state) {
    const [key, value] = id.split(':');
    if (key === 'color') { state.colorIndex = Number(value); return null; }
    if (key === 'size') { state.sizeIndex = Number(value); return null; }
    if (key === 'tool') { state.tool = value; return null; }
    return key;
  }

  #active(id, state) {
    const [key, value] = id.split(':');
    if (key === 'color') return Number(value) === state.colorIndex;
    if (key === 'size') return Number(value) === state.sizeIndex;
    if (key === 'tool') return value === state.tool;
    return false;
  }

  draw(ctx, state, hovered, pointers) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.visible) this.#rail(ctx, state, hovered);
    this.#cursors(ctx, state, pointers);
  }

  #rail(ctx, state, hovered) {
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const s of this.hotspots) {
      const on = this.#active(s.id, state);
      const hot = hovered === s.id;

      if (s.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (on ? 1.2 : hot ? 1.1 : 1), 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = on ? 3 : 1.5;
        ctx.strokeStyle = on ? '#ffffff' : 'rgba(0,0,0,0.4)';
        ctx.stroke();
        continue;
      }

      roundRect(ctx, s.x, s.y, s.w, s.h, 4);
      ctx.fillStyle = on ? 'rgba(245,242,234,0.95)'
        : hot ? 'rgba(10,20,54,0.85)' : 'rgba(10,20,54,0.62)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = on ? '#ffffff' : 'rgba(245,242,234,0.4)';
      ctx.stroke();

      const fg = on ? '#0a1436' : '#f5f2ea';
      ctx.fillStyle = fg;
      ctx.font = `700 ${this.title}px ui-sans-serif, system-ui, sans-serif`;
      const cx = s.x + s.w / 2;
      if (s.sub) {
        ctx.fillText(s.label, cx, s.y + s.h * 0.38);
        ctx.globalAlpha = 0.72;
        ctx.font = `500 ${this.sub}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.fillText(s.sub, cx, s.y + s.h * 0.7);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillText(s.label, cx, s.y + s.h / 2);
      }
    }
    ctx.restore();
  }

  #cursors(ctx, state, pointers) {
    const color = CONFIG.palette[state.colorIndex].hex;
    const size = CONFIG.brushSizes[state.sizeIndex];

    for (const p of pointers) {
      const r = state.tool === 'break' ? size * 1.5 : size * 0.6;
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = state.tool === 'break' ? '#f5f2ea' : color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.pinching ? r * 0.78 : r, 0, Math.PI * 2);
      ctx.stroke();

      if (state.tool === 'break') {
        // A cross-hair reads as "grab", where a filled dot reads as "paint".
        ctx.beginPath();
        ctx.moveTo(p.x - r * 0.4, p.y); ctx.lineTo(p.x + r * 0.4, p.y);
        ctx.moveTo(p.x, p.y - r * 0.4); ctx.lineTo(p.x, p.y + r * 0.4);
        ctx.stroke();
      } else if (p.pinching) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
