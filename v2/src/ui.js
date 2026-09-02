import { CONFIG, POSES } from './config.js';

const ACTIONS = [
  { id: 'undo', label: 'UNDO', sub: '戻す' },
  { id: 'reset', label: 'RESET', sub: '全部戻す' },
  { id: 'done', label: 'DONE', sub: '完成' },
];

const CHAINS = [
  [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16], [0, 17, 18, 19, 20],
];
const PALM = [0, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

// Tools are gestures now, so the rail only carries colour, weight and the
// three one-shot actions. Nothing here needs a click: a hand selects by
// resting on a control, which is the only reliable touchless idiom.
export class UI {
  constructor() {
    this.hotspots = [];
    this.visible = true;
    this.dwell = new Map();
  }

  layout(width, height) {
    const spots = [];
    // Sized from the shorter side: a portrait camera would otherwise get
    // controls scaled to its height and far too big for its width.
    const base = Math.min(width, height);
    const r = Math.max(10, Math.round(base * 0.030));
    const gap = r * 2.7;
    const x = r * 2.1;
    const top = (height - gap * (CONFIG.palette.length - 1)) / 2;

    CONFIG.palette.forEach((c, i) => {
      spots.push({ id: `color:${i}`, kind: 'circle', x, y: top + gap * i, r, color: c.hex });
    });

    const h = Math.max(30, Math.round(base * 0.084));
    const y = height - h - Math.round(height * 0.04);
    let cursor = x - r;
    const rects = [];
    const step = Math.round(h * 0.16);

    const put = (item, w) => {
      const spot = { ...item, kind: 'rect', x: cursor, y, w, h };
      rects.push(spot);
      spots.push(spot);
      cursor += w + step;
    };

    ['S', 'M', 'L'].forEach((label, i) => put({ id: `size:${i}`, label }, Math.round(h * 0.8)));
    cursor += Math.round(h * 0.4);
    for (const a of ACTIONS) put(a, Math.round(h * 1.62));

    // Squeeze the row into the frame rather than letting it run off the edge,
    // which is what a phone in portrait does to it.
    const left = x - r;
    const rowWidth = cursor - step - left;
    const room = width - left * 2;
    const k = rowWidth > room ? room / rowWidth : 1;
    if (k < 1) {
      for (const spot of rects) {
        spot.x = left + (spot.x - left) * k;
        spot.w *= k;
      }
    }

    this.scale = k;
    this.title = Math.round(h * 0.30 * Math.min(1, k * 1.15));
    this.sub = Math.round(h * 0.20 * Math.min(1, k * 1.15));
    // Below this the two-line labels stop being readable at all.
    this.showSub = k > 0.72;
    this.hotspots = spots;
  }

  hitTest(x, y) {
    if (!this.visible) return null;
    for (const s of this.hotspots) {
      if (s.kind === 'circle') {
        if ((x - s.x) ** 2 + (y - s.y) ** 2 <= (s.r * 1.5) ** 2) return s.id;
      } else if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        return s.id;
      }
    }
    return null;
  }

  // Returns the one-shot actions triggered this frame. Colour and weight are
  // applied straight to `state`.
  update(pointers, now, state) {
    const fired = [];
    const live = new Set();

    for (const p of pointers) {
      const hit = this.hitTest(p.x, p.y);
      if (!hit) continue;
      live.add(p.id);

      if (p.instant) {
        fired.push(...this.#activate(hit, state));
        continue;
      }

      const d = this.dwell.get(p.id);
      if (!d || d.hit !== hit) {
        this.dwell.set(p.id, { hit, since: now, x: p.x, y: p.y });
        continue;
      }
      d.x = p.x;
      d.y = p.y;
      if (now - d.since >= CONFIG.dwellMs) {
        fired.push(...this.#activate(hit, state));
        // Restart the clock rather than clearing, so resting on a control
        // does not fire it over and over.
        d.since = now + CONFIG.dwellMs;
      }
    }

    for (const id of [...this.dwell.keys()]) {
      if (!live.has(id)) this.dwell.delete(id);
    }
    return fired;
  }

  #activate(id, state) {
    const [key, value] = id.split(':');
    if (key === 'color') { state.colorIndex = Number(value); return []; }
    if (key === 'size') { state.sizeIndex = Number(value); return []; }
    return [key];
  }

  #progress(id, now) {
    for (const d of this.dwell.values()) {
      if (d.hit !== id) continue;
      return Math.max(0, Math.min(1, (now - d.since) / CONFIG.dwellMs));
    }
    return 0;
  }

  #active(id, state) {
    const [key, value] = id.split(':');
    if (key === 'color') return Number(value) === state.colorIndex;
    if (key === 'size') return Number(value) === state.sizeIndex;
    return false;
  }

  draw(ctx, state, hands, now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const hand of hands) this.#hand(ctx, state, hand);
    if (this.visible) this.#rail(ctx, state, now);
  }

  // The visitor's hands, wearing the colour they are about to leave behind.
  #hand(ctx, state, hand) {
    if (!hand.points) return;
    const p = hand.points;
    const color = CONFIG.palette[state.colorIndex].hex;
    const w = hand.span * 0.26;
    // Dim until the pose has been held long enough to do anything, so the
    // two-part gesture is visible rather than something to be discovered.
    const strength = hand.armed ? 1 : 0.4;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    ctx.globalAlpha = 0.42 * strength;
    ctx.beginPath();
    PALM.forEach((i, n) => (n ? ctx.lineTo(p[i].x, p[i].y) : ctx.moveTo(p[i].x, p[i].y)));
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = w;
    for (const chain of CHAINS) {
      ctx.beginPath();
      chain.forEach((i, n) => (n ? ctx.lineTo(p[i].x, p[i].y) : ctx.moveTo(p[i].x, p[i].y)));
      ctx.stroke();
    }

    // Wet fingertips, with a bead about to fall.
    ctx.globalAlpha = 0.9 * strength;
    for (const i of TIPS) {
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y, w * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p[i].x, p[i].y);
      ctx.lineTo(p[i].x, p[i].y + hand.span * 0.22);
      ctx.lineWidth = w * 0.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y + hand.span * 0.22, w * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Where the tool actually acts. Without it the visitor has to guess
    // which part of their hand the piece is aiming from.
    if (hand.armed) {
      const a = hand.rawX !== undefined ? { x: hand.rawX, y: hand.rawY } : hand;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#f5f2ea';
      ctx.beginPath();
      ctx.arc(a.x, a.y, w * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, w * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const pose = hand.armed ? POSES[hand.pose] : null;
    if (pose) {
      ctx.globalAlpha = 1;
      ctx.font = `700 ${Math.round(hand.span * 0.36)}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(6,16,46,0.85)';
      const ty = p[0].y + hand.span * 0.95;
      ctx.strokeText(pose.label, p[0].x, ty);
      ctx.fillStyle = '#f5f2ea';
      ctx.fillText(pose.label, p[0].x, ty);
    }
    ctx.restore();
  }

  #rail(ctx, state, now) {
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const s of this.hotspots) {
      const on = this.#active(s.id, state);
      const progress = this.#progress(s.id, now);

      if (s.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (on ? 1.2 : 1), 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.lineWidth = on ? 3 : 1.5;
        ctx.strokeStyle = on ? '#ffffff' : 'rgba(0,0,0,0.4)';
        ctx.stroke();
        this.#arc(ctx, s.x, s.y, s.r * 1.5, progress);
        continue;
      }

      roundRect(ctx, s.x, s.y, s.w, s.h, 4);
      ctx.fillStyle = on ? 'rgba(245,242,234,0.95)' : 'rgba(10,20,54,0.66)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = on ? '#ffffff' : 'rgba(245,242,234,0.4)';
      ctx.stroke();

      if (progress > 0) {
        // Selection fills the control from the left as the hand rests on it.
        ctx.save();
        roundRect(ctx, s.x, s.y, s.w, s.h, 4);
        ctx.clip();
        ctx.fillStyle = 'rgba(229,0,110,0.75)';
        ctx.fillRect(s.x, s.y, s.w * progress, s.h);
        ctx.restore();
      }

      ctx.fillStyle = on ? '#0a1436' : '#f5f2ea';
      ctx.font = `700 ${this.title}px ui-sans-serif, system-ui, sans-serif`;
      const cx = s.x + s.w / 2;
      if (s.sub && this.showSub) {
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

  #arc(ctx, x, y, r, progress) {
    if (progress <= 0) return;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#e5006e';
    ctx.stroke();
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
