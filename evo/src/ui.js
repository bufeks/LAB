// DOM overlay helpers. Every scene builds its HUD inside #ui and it is wiped
// on scene change, so no scene has to clean up after itself.

import { sfx } from './audio.js';

const root = document.getElementById('ui');
const toasts = document.getElementById('toasts');

export const ui = {
  root,

  clear() { root.innerHTML = ''; },

  el(tag, cls = '', parent = root, html = '') {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  },

  button(label, cls, onClick, parent = root) {
    const b = ui.el('button', 'btn ' + (cls || ''), parent, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); onClick(e); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  },

  // A horizontal meter: returns an updater.
  meter(parent, label, cls = '') {
    const w = ui.el('div', 'meter ' + cls, parent);
    const l = ui.el('span', 'meter-label', w, label);
    const t = ui.el('div', 'meter-track', w);
    const f = ui.el('div', 'meter-fill', t);
    const v = ui.el('span', 'meter-val', w);
    return (frac, text) => {
      f.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
      if (text != null) v.textContent = text;
      return l;
    };
  },

  toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = msg;
    toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (toasts.children.length > 5) toasts.firstChild.remove();
  },

  // Modal with buttons [{label, cls, onClick}] ; returns the element.
  modal(title, html, buttons = [], cls = '') {
    const back = ui.el('div', 'modal-back');
    const m = ui.el('div', 'modal ' + cls, back);
    ui.el('h2', '', m, title);
    const body = ui.el('div', 'modal-body', m, html);
    const row = ui.el('div', 'modal-buttons', m);
    const close = () => back.remove();
    for (const b of buttons) ui.button(b.label, b.cls || '', () => { if (b.keep !== true) close(); b.onClick?.(); }, row);
    back.addEventListener('pointerdown', (e) => e.stopPropagation());
    back.close = close;
    back.body = body;
    return back;
  },
};

// Floating text drawn on the canvas (damage numbers, +DNA...).
export class Floaters {
  constructor() { this.list = []; }
  add(x, y, text, color = '#fff', size = 14) {
    this.list.push({ x, y, text, color, size, t: 0 });
  }
  update(dt) {
    for (const f of this.list) { f.t += dt; f.y -= 28 * dt; }
    this.list = this.list.filter((f) => f.t < 1.2);
  }
  draw(ctx, zoom = 1) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const f of this.list) {
      ctx.globalAlpha = 1 - f.t / 1.2;
      ctx.font = `bold ${f.size / zoom}px system-ui, sans-serif`;
      ctx.lineWidth = 3 / zoom;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}

// Simple particles.
export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 10, speed = 80, life = 0.6, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: life * (0.6 + Math.random() * 0.6), color, size });
    }
  }
  update(dt) {
    for (const p of this.list) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    this.list = this.list.filter((p) => p.t < p.life);
  }
  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - p.t / p.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
