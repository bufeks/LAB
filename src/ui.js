import { CONFIG } from './config.js';

// The tool rail is drawn on the canvas rather than in the DOM so that the same
// hit-testing serves both a pinching hand and a mouse.
export class UI {
  constructor() {
    this.hotspots = [];
    this.visible = true;
  }

  layout(width, height) {
    const r = Math.max(12, Math.round(height * 0.028));
    const gap = r * 2.6;
    const x = r * 2;
    const top = (height - gap * (CONFIG.palette.length - 1)) / 2;

    const spots = CONFIG.palette.map((color, i) => ({
      id: `color:${i}`,
      kind: 'circle',
      x,
      y: top + gap * i,
      r,
      color,
    }));

    const tools = [
      { id: 'size:0', label: '小' },
      { id: 'size:1', label: '中' },
      { id: 'size:2', label: '大' },
      { id: 'style:solid', label: 'ソリッド' },
      { id: 'style:neon', label: 'ネオン' },
      { id: 'style:spray', label: 'スプレー' },
      { id: 'erase', label: '消す' },
      { id: 'symmetry', label: '左右対称' },
      { id: 'undo', label: '戻す' },
      { id: 'clear', label: '全消し' },
    ];

    const h = Math.max(30, Math.round(height * 0.062));
    const pad = Math.round(h * 0.45);
    const y = height - h - Math.round(height * 0.035);
    let cursor = x - r;

    for (const tool of tools) {
      const w = Math.max(h * 1.5, this.#measure(tool.label, h) + pad * 2);
      spots.push({ ...tool, kind: 'rect', x: cursor, y, w, h });
      cursor += w + Math.round(h * 0.28);
    }

    this.hotspots = spots;
    this.fontSize = Math.round(h * 0.36);
  }

  #measure(text, h) {
    // Rough advance width; good enough for laying out short labels.
    return text.length * h * 0.38;
  }

  hitTest(x, y) {
    if (!this.visible) return null;
    for (const s of this.hotspots) {
      if (s.kind === 'circle') {
        if ((x - s.x) ** 2 + (y - s.y) ** 2 <= (s.r * 1.35) ** 2) return s.id;
      } else if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        return s.id;
      }
    }
    return null;
  }

  // Returns a one-off action name, or null when the state was simply updated.
  activate(id, state) {
    const [key, value] = id.split(':');
    switch (key) {
      case 'color':
        state.colorIndex = Number(value);
        state.erase = false;
        return null;
      case 'size':
        state.sizeIndex = Number(value);
        return null;
      case 'style':
        state.style = value;
        state.erase = false;
        return null;
      case 'erase':
        state.erase = !state.erase;
        return null;
      case 'symmetry':
        state.symmetry = !state.symmetry;
        return null;
      default:
        return key;
    }
  }

  #isActive(id, state) {
    const [key, value] = id.split(':');
    if (key === 'color') return !state.erase && Number(value) === state.colorIndex;
    if (key === 'size') return Number(value) === state.sizeIndex;
    if (key === 'style') return !state.erase && value === state.style;
    if (key === 'erase') return state.erase;
    if (key === 'symmetry') return state.symmetry;
    return false;
  }

  draw(ctx, state, hovered) {
    if (!this.visible) return;
    ctx.save();
    ctx.font = `600 ${this.fontSize}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const s of this.hotspots) {
      const active = this.#isActive(s.id, state);
      const hot = hovered === s.id;

      if (s.kind === 'circle') {
        const r = s.r * (active ? 1.16 : hot ? 1.08 : 1);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = active ? 3 : 1.5;
        ctx.strokeStyle = active ? '#ffffff' : 'rgba(0,0,0,0.45)';
        ctx.stroke();
      } else {
        roundRect(ctx, s.x, s.y, s.w, s.h, s.h * 0.28);
        ctx.fillStyle = active ? 'rgba(255,255,255,0.92)'
          : hot ? 'rgba(0,0,0,0.62)' : 'rgba(0,0,0,0.42)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.35)';
        ctx.stroke();
        ctx.fillStyle = active ? '#0b0c0e' : '#f2f3f5';
        ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2 + 1);
      }
    }
    ctx.restore();
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
