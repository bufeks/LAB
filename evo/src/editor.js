// Creature / cell editor. Drag parts onto the body, reshape the spine,
// recolour, and spend DNA. The result is the design used in the next stage.

import { game } from './game.js';
import { ui } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, hsl } from './util.js';
import {
  PARTS, STAT_LABELS, CELL_STATS, CREATURE_STATS, DIET_LABEL,
  computeStats, drawCreature, drawPartIcon, cloneDesign, designCost, isMirrored, anchorOf,
} from './creature.js';

export class EditorScene {
  // opts: { kind, design, dna, unlocked, title, doneLabel, onDone(design, dnaLeft) }
  constructor(opts) {
    this.o = opts;
    this.kind = opts.kind;
    this.d = cloneDesign(opts.design);
    this.budget = opts.dna + designCost(opts.design);
    this.phase = 0;
    this.walk = false;
    this.held = null;        // part being placed/dragged: {part, isNew}
    this.dragSeg = null;     // {i, mode:'move'|'size'}
    this.hover = null;
    this.maxSeg = this.kind === 'cell' ? 3 : 7;
    this.maxParts = this.kind === 'cell' ? 14 : 24;
    this.undo = [];
  }

  get remaining() { return this.budget - designCost(this.d); }

  enter() {
    const k = this.kind;
    ui.el('div', 'editor-title', ui.root, this.o.title || (k === 'cell' ? '細胞エディタ' : 'クリーチャーエディタ'));

    // --- part palette
    const left = (this.left = ui.el('div', 'panel editor-parts'));
    ui.el('h3', '', left, 'パーツ');
    const grid = ui.el('div', 'part-grid', left);
    const types = Object.keys(PARTS).filter((t) => {
      const st = PARTS[t].stage;
      return (st === k || st === 'all') && this.o.unlocked.includes(t);
    });
    const locked = Object.keys(PARTS).filter((t) => (PARTS[t].stage === k || PARTS[t].stage === 'all') && !this.o.unlocked.includes(t));
    for (const t of types) {
      const b = ui.el('button', 'part-btn', grid);
      const cv = ui.el('canvas', '', b);
      cv.width = cv.height = 44;
      drawPartIcon(cv.getContext('2d'), t, 44, this.d);
      ui.el('span', 'pname', b, PARTS[t].name);
      ui.el('span', 'pcost', b, '🧬' + PARTS[t].cost);
      b.title = PARTS[t].desc;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.pickNew(t);
      });
    }
    for (const t of locked) {
      const b = ui.el('button', 'part-btn locked', grid);
      ui.el('span', 'lock', b, '？');
      ui.el('span', 'pname', b, '未発見');
      b.title = k === 'cell' ? '他の細胞を倒したり、隕石のかけらを拾うと見つかる' : '島に散らばる骨を調べると見つかる';
    }
    this.tip = ui.el('div', 'part-tip', left, 'パーツを押して体の近くに置こう。<br>置いたパーツはドラッグで移動、体の外へ捨てると削除。<br>ホイールで大きさ変更。');

    // --- properties
    const right = (this.right = ui.el('div', 'panel editor-props'));
    const nameRow = ui.el('label', 'row', right, '<span>名前</span>');
    const name = ui.el('input', '', nameRow);
    name.value = this.d.name;
    name.maxLength = 12;
    name.addEventListener('input', () => { this.d.name = name.value || '名無し'; });

    this.dnaLabel = ui.el('div', 'dna-big', right);

    const colorRow = (label, key, max) => {
      const r = ui.el('label', 'row', right, `<span>${label}</span>`);
      const s = ui.el('input', 'hue', r);
      s.type = 'range'; s.min = 0; s.max = max; s.value = this.d[key];
      if (key !== 'sat') s.style.background = 'linear-gradient(90deg,' + [0, 60, 120, 180, 240, 300, 360].map((h) => hsl(h, 70, 55)).join(',') + ')';
      s.addEventListener('input', () => { this.d[key] = +s.value; });
    };
    colorRow('体の色', 'hue', 360);
    colorRow('あざやかさ', 'sat', 90);
    colorRow('模様の色', 'hue2', 360);
    const pat = ui.el('div', 'row seg-row', right, '<span>模様</span>');
    ['なし', '水玉', 'しま'].forEach((l, i) => ui.button(l, 'small', () => { this.d.pattern = i; }, pat));

    const segRow = ui.el('div', 'row seg-row', right, '<span>体節</span>');
    ui.button('＋追加', 'small', () => this.addSeg(), segRow);
    ui.button('－削除', 'small', () => this.removeSeg(), segRow);
    const misc = ui.el('div', 'row seg-row', right);
    ui.button('↶ 戻す', 'small', () => this.popUndo(), misc);
    if (k === 'creature') ui.button('歩かせる', 'small', () => { this.walk = !this.walk; }, misc);

    this.statBox = ui.el('div', 'stats', right);
    ui.button(this.o.doneLabel || '完成！', 'primary big', () => this.finish(), right);
    this.refreshStats();
  }

  pushUndo() {
    this.undo.push(JSON.stringify(this.d));
    if (this.undo.length > 40) this.undo.shift();
  }
  popUndo() {
    const s = this.undo.pop();
    if (s) { this.d = JSON.parse(s); this.refreshStats(); sfx.remove(); }
  }

  pickNew(type) {
    if (this.d.parts.length >= this.maxParts) { ui.toast('これ以上パーツを付けられません', 'bad'); return; }
    if (this.remaining < PARTS[type].cost) { ui.toast('DNAが足りません', 'bad'); sfx.bad(); return; }
    this.held = { part: { type, seg: 0, a: Math.PI / 2, s: 1 }, isNew: true, attached: false };
    sfx.click();
  }

  addSeg() {
    if (this.d.spine.length >= this.maxSeg) { ui.toast(`体節は${this.maxSeg}つまで`, 'bad'); return; }
    this.pushUndo();
    const last = this.d.spine[this.d.spine.length - 1];
    this.d.spine.push({ x: last.x - last.r * 1.3, y: 0, r: Math.max(6, last.r * 0.85) });
    sfx.place();
    this.refreshStats();
  }
  removeSeg() {
    if (this.d.spine.length <= 1) return;
    this.pushUndo();
    const n = this.d.spine.length - 1;
    this.d.spine.pop();
    for (const p of this.d.parts) if (p.seg >= n) p.seg = n - 1;
    sfx.remove();
    this.refreshStats();
  }

  refreshStats() {
    const st = computeStats(this.d);
    const keys = this.kind === 'cell' ? CELL_STATS : CREATURE_STATS;
    let html = `<div class="diet ${st.diet}">食性: <b>${DIET_LABEL[st.diet]}</b></div>`;
    html += `<div class="stat"><span>体力</span><div class="pips">${pips(Math.min(5, st.mass / (this.kind === 'cell' ? 120 : 250)))}</div></div>`;
    for (const k of keys) {
      if (k === 'turn' || k === 'sight') continue;
      html += `<div class="stat ${st[k] > 0 ? '' : 'zero'}"><span>${STAT_LABELS[k]}</span><div class="pips">${pips(st[k])}</div></div>`;
    }
    this.statBox.innerHTML = html;
  }

  finish() {
    const st = computeStats(this.d);
    if (st.diet === 'none') { ui.toast('口がないと食べられません！口のパーツを付けよう', 'bad'); sfx.bad(); return; }
    if (this.kind === 'creature' && st.speed <= 0) { ui.toast('あしを付けないと動けません！', 'bad'); sfx.bad(); return; }
    if (this.kind === 'cell' && st.speed <= 0) { ui.toast('べん毛かせん毛がないと泳げません！', 'bad'); sfx.bad(); return; }
    sfx.level();
    this.o.onDone(this.d, this.remaining);
  }

  // --- geometry
  view() {
    const w = game.w, h = game.h;
    let x0 = 0, x1 = w, y0 = 0, y1 = h;
    const lr = this.left.getBoundingClientRect(), rr = this.right.getBoundingClientRect();
    if (w > 820) { x0 = lr.right; x1 = rr.left; } else { y0 = rr.bottom; y1 = lr.top; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 10;
    const avail = Math.min(x1 - x0, y1 - y0);
    const scale = clamp(avail * 0.42 / (this.kind === 'cell' ? 42 : 80), 1.2, 6);
    return { cx, cy, scale };
  }
  toLocal(sx, sy) {
    const v = this.view();
    return { x: (sx - v.cx) / v.scale, y: (sy - v.cy) / v.scale };
  }

  // Closest segment edge to a local point -> {seg, a, gap}
  nearestEdge(p) {
    let best = null;
    this.d.spine.forEach((s, i) => {
      const dd = Math.hypot(p.x - s.x, p.y - s.y);
      const gap = Math.abs(dd - s.r);
      if (!best || gap < best.gap) best = { seg: i, a: Math.atan2(p.y - s.y, p.x - s.x), gap, inside: dd < s.r };
    });
    return best;
  }

  partAt(p) {
    const pose = this.d.spine;
    for (let i = this.d.parts.length - 1; i >= 0; i--) {
      const part = this.d.parts[i];
      const def = PARTS[part.type];
      for (const a of isMirrored(part.a) ? [part.a, -part.a] : [part.a]) {
        const an = anchorOf(pose, { ...part, a }, def.under);
        const ex = an.x + Math.cos(a) * 6 * part.s, ey = an.y + Math.sin(a) * 6 * part.s;
        if (Math.hypot(p.x - ex, p.y - ey) < 9 * part.s) return { i, mirrored: a !== part.a };
      }
    }
    return null;
  }

  update(dt) {
    const inp = game.input;
    this.phase += dt * (this.walk ? 6 : 2);
    const m = this.toLocal(inp.mouse.x, inp.mouse.y);
    const v = this.view();

    // dragging a part (new or existing)
    if (this.held) {
      const e = this.nearestEdge({ x: m.x, y: m.y });
      const p = this.held.part;
      this.held.attached = e.gap < 22;
      if (this.held.attached) {
        p.seg = e.seg;
        let a = e.a;
        const lat = Math.abs(Math.sin(a));
        if (lat < 0.18) a = Math.cos(a) > 0 ? 0 : Math.PI;
        if (this.held.mirrored) a = -a;
        p.a = a;
      }
      if (inp.wheel) p.s = clamp((p.s || 1) - inp.wheel * 0.1, 0.6, 1.7);
      const released = this.held.isNew ? inp.clicks.length > 0 : !inp.mouse.down;
      if (released) {
        if (this.held.attached) {
          if (this.held.isNew) { this.pushUndo(); this.d.parts.push(p); }
          sfx.place();
        } else if (!this.held.isNew) {
          this.d.parts.splice(this.d.parts.indexOf(p), 1);
          sfx.remove();
        }
        this.held = null;
        this.refreshStats();
      }
      return;
    }

    if (this.dragSeg) {
      const s = this.d.spine[this.dragSeg.i];
      if (this.dragSeg.mode === 'move') s.x = clamp(m.x, -80, 80);
      else s.r = clamp(Math.hypot(m.x - s.x, m.y - s.y), 5, this.kind === 'cell' ? 28 : 26);
      if (!inp.mouse.down) { this.dragSeg = null; this.refreshStats(); }
      return;
    }

    // hover
    const hitPart = this.partAt(m);
    let hitSeg = null;
    this.d.spine.forEach((s, i) => {
      const dd = Math.hypot(m.x - s.x, m.y - s.y);
      if (dd < 5 / v.scale * 3) hitSeg = { i, mode: 'move' };
      else if (!hitSeg && Math.abs(dd - s.r) < 8 / v.scale * 2 && !hitPart) hitSeg = { i, mode: 'size' };
    });
    this.hover = hitPart ? { part: hitPart } : hitSeg ? { seg: hitSeg } : null;
    game.canvas.style.cursor = hitPart ? 'grab' : hitSeg ? (hitSeg.mode === 'move' ? 'ew-resize' : 'nwse-resize') : 'default';

    if (inp.wheel && this.hover) {
      this.pushUndo();
      if (this.hover.part) {
        const p = this.d.parts[this.hover.part.i];
        p.s = clamp((p.s || 1) - inp.wheel * 0.1, 0.6, 1.7);
      } else {
        const s = this.d.spine[this.hover.seg.i];
        s.r = clamp(s.r - inp.wheel, 5, 28);
      }
      this.refreshStats();
    }

    if (inp.mouse.down && inp.drag && Math.hypot(inp.drag.x - inp.drag.x0, inp.drag.y - inp.drag.y0) < 3) {
      const start = this.toLocal(inp.drag.x0, inp.drag.y0);
      const hp = this.partAt(start);
      if (hp) {
        this.pushUndo();
        this.held = { part: this.d.parts[hp.i], isNew: false, attached: true, mirrored: hp.mirrored };
      } else if (this.hover?.seg) {
        this.pushUndo();
        this.dragSeg = this.hover.seg;
      }
    }
  }

  draw(ctx) {
    const w = game.w, h = game.h;
    const g = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h) * 0.7);
    if (this.kind === 'cell') { g.addColorStop(0, '#1d4a66'); g.addColorStop(1, '#07182a'); }
    else { g.addColorStop(0, '#4b5a3a'); g.addColorStop(1, '#151a12'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const v = this.view();
    // pedestal
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.arc(v.cx, v.cy, (this.kind === 'cell' ? 50 : 90) * v.scale, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(v.cx - 100 * v.scale, v.cy); ctx.lineTo(v.cx + 100 * v.scale, v.cy); ctx.stroke();
    ctx.setLineDash([]);

    // show where a held part would go
    const d = this.d;
    const show = this.held && this.held.isNew && this.held.attached ? { ...d, parts: [...d.parts, this.held.part] } : d;
    if (this.held && !this.held.attached && !this.held.isNew) {
      // being dragged off: draw without it
      drawCreature(ctx, { ...d, parts: d.parts.filter((p) => p !== this.held.part) }, v.cx, v.cy, 0, v.scale, { phase: this.phase, move: this.walk ? 1 : 0.15 });
    } else {
      drawCreature(ctx, show, v.cx, v.cy, 0, v.scale, { phase: this.phase, move: this.walk ? 1 : 0.15 });
    }
    // copy the palette cache back so icons stay in sync
    d._pal = show._pal; d._palKey = show._palKey;

    // floating held part
    if (this.held && !this.held.attached) {
      const inp = game.input;
      ctx.save();
      ctx.globalAlpha = 0.7;
      const tmp = { ...d, spine: [{ x: 0, y: 0, r: 4 }], parts: [{ ...this.held.part, seg: 0, a: 0 }] };
      drawCreature(ctx, tmp, inp.mouse.x, inp.mouse.y, 0, v.scale, { phase: this.phase, shadow: false });
      if (!this.held.isNew) {
        ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('はなすと削除', inp.mouse.x, inp.mouse.y - 30);
      }
      ctx.restore();
    }

    // segment handles
    d.spine.forEach((s, i) => {
      const x = v.cx + s.x * v.scale, y = v.cy + s.y * v.scale;
      const hot = this.hover?.seg?.i === i || this.dragSeg?.i === i;
      ctx.strokeStyle = hot ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
      if (hot && (this.hover?.seg?.mode === 'size' || this.dragSeg?.mode === 'size')) {
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, s.r * v.scale, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    this.dnaLabel.innerHTML = `🧬 DNA <b>${this.remaining}</b>`;
  }
}

function pips(v) {
  let s = '';
  for (let i = 0; i < 5; i++) {
    const f = clamp(v - i, 0, 1);
    s += `<i style="--f:${f}"></i>`;
  }
  return s;
}
