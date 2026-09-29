// Civilization stage: unite the planet. Take cities by force (tanks),
// by faith (missionaries) or by money (buy them outright).

import { game } from './game.js';
import { ui, Floaters, Particles } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, rng, mulberry32, turnTowards, Camera, hsl, fmt } from './util.js';
import { drawCreature, randomDesign } from './creature.js';
import { Terrain } from './terrain.js';
import { Selector, separate, drawBar } from './rts.js';
import { classify } from './save.js';

const SIZE = 3400;
const VEH = {
  tank: { name: '戦車', cost: 120, hp: 70, dmg: 9, speed: 70, icon: '🛡' },
  preacher: { name: '宣教師', cost: 140, hp: 50, dmg: 0, faith: 5, speed: 60, icon: '🔔' },
};

export class CivScene {
  constructor() {
    const s = game.save;
    this.seed = (s.world?.seed || 1) + 202;
    this.terrain = new Terrain(SIZE, this.seed, 'civ');
    this.cam = new Camera();
    this.cam.zoom = 0.7;
    this.fl = new Floaters();
    this.px = new Particles();
    this.sel = new Set();
    this.selector = new Selector();
    this.t = 0;
    this.money = 400;
    this.design = s.creatureDesign;
    const tr = s.traits.tribe;
    this.buyMul = tr === 'social' ? 0.7 : 1;
    this.atkMul = tr === 'aggressive' ? 1.4 : 1;
    this.incMul = tr === 'mixed' ? 1.25 : 1;
    this.captures = { peace: 0, war: 0 };
    this.build();
  }

  build() {
    const r = mulberry32(this.seed);
    const T = this.terrain;
    const pts = [];
    const place = (minD) => {
      for (let k = 0; k < 400; k++) {
        const p = T.randomLand(r, 0.36, 0.6);
        if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > minD)) { pts.push(p); return p; }
      }
      const p = T.randomLand(r); pts.push(p); return p;
    };
    // nations: 0 = player, 1..3 rivals (each with 2 cities)
    const sps = (game.save.species || []).filter((x) => x.design && x.fate !== 'extinct');
    this.nations = [{ id: 0, name: this.design.name + '国', design: this.design, color: hsl(this.design.hue, 75, 55), war: false }];
    for (let i = 1; i <= 3; i++) {
      const d = sps[i - 1]?.design || randomDesign(r.int(1, 1e9), 'creature', 'omni', 2);
      this.nations.push({ id: i, name: d.name + '国', design: d, color: hsl(d.hue, 75, 55), war: false, money: 150, buildT: r.range(40, 70), warT: 150 + i * 70 });
    }
    this.cities = [];
    const mk = (owner, cap) => {
      const p = place(520);
      const lvl = cap ? 2 : r.int(1, 2);
      const c = { x: p.x, y: p.y, owner, level: lvl, def: 100 * lvl, maxDef: 100 * lvl, faith: 100, capital: cap, r: 60 + lvl * 12, gunCd: 0, name: cityName(r) };
      this.cities.push(c);
      return c;
    };
    this.capital = mk(0, true);
    for (let i = 1; i <= 3; i++) { mk(i, true); mk(i, false); }
    mk(-1, false); mk(-1, false); // independent towns
    this.geysers = [];
    for (let i = 0; i < 10; i++) { const p = place(260); this.geysers.push({ x: p.x, y: p.y, owner: -1, claim: 0, claimer: -1 }); }
    this.vehicles = [];
    this.spawnVehicle(0, 'tank', this.capital);
    this.spawnVehicle(0, 'preacher', this.capital);
    this.cam.x = this.capital.x; this.cam.y = this.capital.y;
  }

  spawnVehicle(owner, kind, city) {
    const def = VEH[kind];
    const a = rng() * TAU;
    const v = {
      owner, kind, x: city.x + Math.cos(a) * (city.r + 20), y: city.y + Math.sin(a) * (city.r + 20), rot: a,
      hp: def.hp, maxHp: def.hp, r: 14, state: 'idle', target: null, cd: 0, hurt: 0, goal: null,
    };
    this.vehicles.push(v);
    return v;
  }

  cityCost(c) { return Math.round((300 + c.level * 350 + (c.capital ? 300 : 0)) * this.buyMul); }
  income(owner) {
    let inc = 0;
    for (const c of this.cities) if (c.owner === owner) inc += 3 + c.level * 3;
    for (const g of this.geysers) if (g.owner === owner) inc += 4;
    return inc * (owner === 0 ? this.incMul : 1);
  }

  enter() {
    const top = ui.el('div', 'hud top-left');
    ui.el('div', 'stage-name', top, '文明期');
    this.resEl = ui.el('div', 'res', top);
    const right = ui.el('div', 'hud top-right');
    this.nextBtn = ui.button('🚀 宇宙へ！', 'primary hidden', () => this.finish(), right);
    ui.button('⏸', 'small', () => game.go('title'), right).title = 'タイトルへ';
    this.natList = ui.el('div', 'panel species-list', right);
    const bottom = ui.el('div', 'hud bottom-center');
    const bar = ui.el('div', 'abilities', bottom);
    ui.button(`🛡 戦車 <small>§${VEH.tank.cost}</small>`, '', () => this.buy('tank'), bar);
    ui.button(`🔔 宣教師 <small>§${VEH.preacher.cost}</small>`, '', () => this.buy('preacher'), bar);
    ui.button('🚙 全車両 [A]', '', () => { this.sel = new Set(this.myVehicles); }, bar);
    this.selInfo = ui.el('div', 'sel-info', bottom);
    this.mini = ui.el('canvas', 'minimap', ui.root);
    this.mini.width = this.mini.height = 150;
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = this.mini.getBoundingClientRect();
      this.cam.x = (e.clientX - r.left) / r.width * SIZE; this.cam.y = (e.clientY - r.top) / r.height * SIZE;
    });
    ui.modal('文明期', `
      <p>部族はやがて国となった。惑星には他に3つの国と、独立した町があります。</p>
      <ul>
        <li><b>🛡 戦車</b>: 都市の防御を削って占領（相手国とは戦争になる）</li>
        <li><b>🔔 宣教師</b>: 都市の信仰を変えて平和的に取り込む（砲台に撃たれない）</li>
        <li><b>💰 買収</b>: 都市をクリックしてお金で買い取る</li>
        <li><b>⛲ スパイス源泉</b> に車両を置くと採掘所ができ、収入が増える</li>
        <li>操作は部族期と同じ: ドラッグで選択、右クリック（タップ）で命令</li>
        <li>惑星のすべての都市を手に入れると宇宙期へ！</li>
      </ul>`, [{ label: 'はじめる', cls: 'primary' }]);
    this.refreshList();
  }

  isWar(a, b) {
    if (a === b || a < 0 || b < 0) return false;
    if (a === 0) return this.nations[b].war;
    if (b === 0) return this.nations[a].war;
    return false;
  }

  get myVehicles() { return this.vehicles.filter((v) => v.owner === 0); }

  buy(kind) {
    const def = VEH[kind];
    if (this.money < def.cost) { ui.toast('お金が足りません', 'bad'); sfx.bad(); return; }
    // build at the owned city closest to the camera
    let best = null, bd = 1e9;
    for (const c of this.cities) if (c.owner === 0) { const d = Math.hypot(c.x - this.cam.x, c.y - this.cam.y); if (d < bd) { bd = d; best = c; } }
    if (!best) return;
    this.money -= def.cost;
    const v = this.spawnVehicle(0, kind, best);
    this.sel = new Set([v]);
    sfx.build();
  }

  refreshList() {
    let h = '<h3>国々</h3>';
    for (const n of this.nations.slice(1)) {
      const cities = this.cities.filter((c) => c.owner === n.id).length;
      h += `<div class="sp"><i style="background:${n.color}"></i>${n.name}<span>${cities ? `🏙${cities} ${n.war ? '<span class="bad">戦争中</span>' : '平和'}` : '<span class="ok">統合済</span>'}</span></div>`;
    }
    const ind = this.cities.filter((c) => c.owner === -1).length;
    if (ind) h += `<div class="sp"><i style="background:#aaa"></i>独立都市<span>🏙${ind}</span></div>`;
    this.natList.innerHTML = h;
  }

  openCity(c) {
    if (c.owner === 0) return;
    const cost = this.cityCost(c);
    const owner = c.owner === -1 ? '独立都市' : this.nations[c.owner].name;
    const m = ui.modal(`${c.name}（${owner}）`, `
      <p>規模 Lv${c.level}　防御 ${Math.round(c.def)}/${c.maxDef}　信仰 ${Math.round(c.faith)}%</p>
      <p class="hint">戦車で防御を0に、宣教師で信仰を0にすると手に入る。お金で買収もできる。</p>`, [
      { label: `💰 買収する (§${fmt(cost)})`, onClick: () => this.purchase(c) },
      { label: `🛡 選択中の車両で向かう (${this.sel.size})`, onClick: () => this.command([...this.sel], c) },
      { label: '閉じる' },
    ]);
    return m;
  }

  purchase(c) {
    const cost = this.cityCost(c);
    if (this.money < cost) { ui.toast(`お金が足りません（§${fmt(cost)}必要）`, 'bad'); sfx.bad(); return; }
    this.money -= cost;
    this.capture(c, 'peace');
  }

  capture(c, how) {
    const prev = c.owner;
    c.owner = 0;
    c.def = c.maxDef * 0.5;
    c.faith = 100;
    this.captures[how]++;
    sfx.win();
    this.px.burst(c.x, c.y, this.nations[0].color, 30, 150, 1, 5);
    ui.toast(`🏙 <b>${c.name}</b> が${this.nations[0].name}の一部になった！（${how === 'war' ? '占領' : '平和的に統合'}）`, 'good');
    if (prev > 0 && how === 'war') this.nations[prev].war = true;
    for (const v of this.vehicles) if (v.target === c && v.owner === 0) { v.state = 'idle'; v.target = null; }
    this.refreshList();
    if (this.cities.every((x) => x.owner === 0)) {
      this.nextBtn.classList.remove('hidden');
      ui.toast('<b>惑星が統一された！</b>「宇宙へ！」で最後の段階へ', 'good');
    }
  }

  finish() {
    const s = game.save;
    s.traits.civ = classify(this.captures.peace, this.captures.war);
    game.persist();
    game.startStage('space');
  }

  command(units, target) {
    if (!units.length) { ui.toast('先に車両を選択してください', 'bad'); return; }
    let i = 0;
    for (const v of units) {
      i++;
      if (target.level != null) { v.state = 'city'; v.target = target; }
      else if (target.claim != null) { v.state = 'geyser'; v.target = target; }
      else if (target.kind) { v.state = 'attack'; v.target = target; }
      else { v.state = 'move'; v.goal = { x: target.x + ((i % 3) - 1) * 30, y: target.y + (Math.floor(i / 3) - 1) * 30 }; }
    }
    sfx.click();
  }

  pick(w) {
    for (const v of this.vehicles) if (Math.hypot(v.x - w.x, v.y - w.y) < v.r + 8) return { v };
    for (const c of this.cities) if (Math.hypot(c.x - w.x, c.y - w.y) < c.r) return { c };
    for (const g of this.geysers) if (Math.hypot(g.x - w.x, g.y - w.y) < 30) return { g };
    return null;
  }

  update(dt) {
    const inp = game.input;
    const cam = this.cam;
    this.t += dt;
    game.save.stats.time += dt;
    cam.w = game.w; cam.h = game.h;

    const pan = 600 / cam.zoom * dt;
    if (inp.isDown('ArrowLeft')) cam.x -= pan;
    if (inp.isDown('ArrowRight')) cam.x += pan;
    if (inp.isDown('ArrowUp')) cam.y -= pan;
    if (inp.isDown('ArrowDown')) cam.y += pan;
    if (inp.wheel) cam.zoom = clamp(cam.zoom * (inp.wheel > 0 ? 0.9 : 1.1), 0.25, 1.6);
    if (inp.drag && inp.drag.touch) {
      if (this.lastDrag) { cam.x -= (inp.drag.x - this.lastDrag.x) / cam.zoom; cam.y -= (inp.drag.y - this.lastDrag.y) / cam.zoom; }
      this.lastDrag = { x: inp.drag.x, y: inp.drag.y };
    } else this.lastDrag = null;
    cam.x = clamp(cam.x, 0, SIZE); cam.y = clamp(cam.y, 0, SIZE);
    if (inp.wasPressed('KeyA')) this.sel = new Set(this.myVehicles);
    if (inp.wasPressed('Escape')) this.sel.clear();

    this.selector.update(cam, this.myVehicles, this.sel);
    for (const c of inp.clicks) {
      const w = cam.toWorld(c.x, c.y);
      const h = this.pick(w);
      if (c.button === 2) { if (this.sel.size) this.command([...this.sel], h?.c || h?.g || (h?.v && h.v.owner !== 0 ? h.v : null) || w); continue; }
      if (h?.v && h.v.owner === 0) { if (!c.shift) this.sel.clear(); this.sel.add(h.v); }
      else if (h?.c && h.c.owner !== 0 && !this.sel.size) this.openCity(h.c);
      else if (this.sel.size) this.command([...this.sel], h?.c || h?.g || (h?.v && h.v.owner !== 0 ? h.v : null) || w);
      else if (h?.c && h.c.owner !== 0) this.openCity(h.c);
    }

    // economy
    this.money += this.income(0) * dt;
    for (const n of this.nations.slice(1)) {
      n.money += this.income(n.id) * dt * 0.6;
      const mine = this.cities.filter((c) => c.owner === n.id);
      if (!mine.length) continue;
      n.warT -= dt;
      if (n.warT <= 0 && !n.war) {
        n.war = true;
        ui.toast(`⚠ <b>${n.name}</b> が宣戦布告してきた！`, 'bad');
        sfx.bad();
        this.refreshList();
      }
      n.buildT -= dt;
      if (n.buildT <= 0 && n.money >= VEH.tank.cost) {
        n.buildT = rng.range(35, 60);
        n.money -= VEH.tank.cost;
        const own = this.vehicles.filter((v) => v.owner === n.id).length;
        if (own < 6) {
          const v = this.spawnVehicle(n.id, 'tank', rng.pick(mine));
          // AI: grab a geyser, or attack us if at war
          if (n.war) {
            const tgt = this.cities.filter((c) => c.owner === 0).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
            if (tgt) { v.state = 'city'; v.target = tgt; }
          } else {
            const g = this.geysers.filter((g) => g.owner === -1).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
            if (g) { v.state = 'geyser'; v.target = g; }
          }
        }
      }
    }

    // city turrets shoot hostile tanks
    for (const c of this.cities) {
      c.gunCd -= dt;
      c.def = Math.min(c.maxDef, c.def + dt * 1.5);
      c.faith = Math.min(100, c.faith + dt * 0.4);
      if (c.gunCd > 0) continue;
      const hostile = this.vehicles.find((v) => v.kind === 'tank' && v.owner !== c.owner && (v.target === c || this.isWar(c.owner, v.owner)) && Math.hypot(v.x - c.x, v.y - c.y) < c.r + 140);
      if (hostile) {
        c.gunCd = 1.4;
        this.shot = this.shot || [];
        this.shot.push({ x0: c.x, y0: c.y, x1: hostile.x, y1: hostile.y, t: 0.15 });
        this.damage(hostile, 6 + c.level * 2);
      }
    }
    if (this.shot) { for (const s of this.shot) s.t -= dt; this.shot = this.shot.filter((s) => s.t > 0); }

    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.vehicles = this.vehicles.filter((v) => !v.dead);
    for (const v of [...this.sel]) if (v.dead) this.sel.delete(v);
    separate(this.vehicles, dt);

    if (!this.cities.some((c) => c.owner === 0)) {
      ui.toast('すべての都市を失った…　文明期をやり直します', 'bad');
      game.go('civ');
      return;
    }

    this.fl.update(dt);
    this.px.update(dt);
    this.resEl.innerHTML = `💰 <b>§${fmt(this.money)}</b> <small>(+${this.income(0).toFixed(0)}/秒)</small>　🏙 ${this.cities.filter((c) => c.owner === 0).length} / ${this.cities.length}`;
    this.selInfo.textContent = this.sel.size ? `${this.sel.size}台選択中 — 都市・源泉・敵車両を右クリック/タップ` : '車両をドラッグで選択（Aキーで全部）';
    if ((this.listT = (this.listT || 0) - dt) <= 0) { this.listT = 1; this.refreshList(); }
  }

  damage(v, dmg) {
    v.hp -= dmg; v.hurt = 1;
    this.fl.add(v.x, v.y - 20, '-' + Math.round(dmg), v.owner === 0 ? '#ff8080' : '#ffd36b', 12);
    if (v.hp <= 0 && !v.dead) {
      v.dead = true;
      sfx.hit();
      this.px.burst(v.x, v.y, '#ffa040', 20, 120, 0.7, 4);
    }
  }

  updateVehicle(v, dt) {
    const def = VEH[v.kind];
    v.cd -= dt; v.hurt = Math.max(0, v.hurt - dt * 3);
    let gx = null, gy = null, stop = 6;
    const enemyOf = (o) => this.isWar(v.owner, o.owner);

    // tanks engage nearby hostile vehicles
    if (v.kind === 'tank' && v.state !== 'attack') {
      const e = this.vehicles.find((o) => !o.dead && enemyOf(o) && Math.hypot(o.x - v.x, o.y - v.y) < 180);
      if (e) { v.prev = { state: v.state, target: v.target }; v.state = 'attack'; v.target = e; }
    }

    if (v.state === 'move') {
      gx = v.goal.x; gy = v.goal.y;
      if (Math.hypot(gx - v.x, gy - v.y) < 8) v.state = 'idle';
    } else if (v.state === 'attack') {
      const t = v.target;
      if (!t || t.dead || v.kind !== 'tank') { if (v.prev) { v.state = v.prev.state; v.target = v.prev.target; v.prev = null; } else v.state = 'idle'; }
      else {
        gx = t.x; gy = t.y; stop = 110;
        if (Math.hypot(t.x - v.x, t.y - v.y) < 130 && v.cd <= 0) {
          v.cd = 1.1;
          this.damage(t, def.dmg * (v.owner === 0 ? this.atkMul : 1));
          this.shot = this.shot || [];
          this.shot.push({ x0: v.x, y0: v.y, x1: t.x, y1: t.y, t: 0.12, col: this.nations[v.owner].color });
          sfx.laser();
          if (t.owner === 0 || v.owner === 0) { const n = this.nations[t.owner === 0 ? v.owner : t.owner]; if (n && !n.war) { n.war = true; this.refreshList(); } }
        }
      }
    } else if (v.state === 'city') {
      const c = v.target;
      if (c.owner === v.owner) { v.state = 'idle'; }
      else {
        gx = c.x; gy = c.y; stop = c.r + 50;
        if (Math.hypot(c.x - v.x, c.y - v.y) < c.r + 60) {
          gx = null;
          if (v.cd <= 0) {
            v.cd = 1;
            if (v.kind === 'tank') {
              const dmg = def.dmg * (v.owner === 0 ? this.atkMul : 1);
              c.def -= dmg;
              this.shot = this.shot || [];
              this.shot.push({ x0: v.x, y0: v.y, x1: c.x + rng.range(-20, 20), y1: c.y + rng.range(-20, 20), t: 0.12, col: this.nations[v.owner].color });
              sfx.laser();
              if (v.owner === 0 && c.owner > 0 && !this.nations[c.owner].war) { this.nations[c.owner].war = true; ui.toast(`${this.nations[c.owner].name} と戦争になった！`, 'bad'); this.refreshList(); }
              if (c.def <= 0) {
                if (v.owner === 0) this.capture(c, 'war');
                else {
                  c.owner = v.owner; c.def = c.maxDef * 0.5; c.faith = 100;
                  ui.toast(`🏙 ${c.name} が ${this.nations[v.owner].name} に奪われた！`, 'bad');
                  sfx.die();
                  this.refreshList();
                }
              }
            } else {
              c.faith -= def.faith;
              this.fl.add(c.x + rng.range(-30, 30), c.y - c.r, '🔔', '#fff', 16);
              if (c.faith <= 0 && v.owner === 0) this.capture(c, 'peace');
            }
          }
        }
      }
    } else if (v.state === 'geyser') {
      const g = v.target;
      if (g.owner === v.owner) v.state = 'idle';
      else {
        gx = g.x; gy = g.y; stop = 30;
        if (Math.hypot(g.x - v.x, g.y - v.y) < 40) {
          gx = null;
          if (g.claimer !== v.owner) { g.claimer = v.owner; g.claim = 0; }
          g.claim += dt;
          if (g.claim >= 4) {
            g.owner = v.owner; g.claim = 0;
            if (v.owner === 0) { sfx.good(); ui.toast('⛲ スパイス採掘所を建てた！ 収入アップ', 'good'); }
            v.state = 'idle';
          }
        }
      }
    }

    if (gx != null) {
      const d = Math.hypot(gx - v.x, gy - v.y);
      if (d > stop) {
        const a = Math.atan2(gy - v.y, gx - v.x);
        v.rot = turnTowards(v.rot, a, 4 * dt);
        const water = !this.terrain.isLand(v.x, v.y);
        const sp = def.speed * (water ? 0.55 : 1) * dt;
        v.x += Math.cos(v.rot) * sp; v.y += Math.sin(v.rot) * sp;
      }
    }
  }

  draw(ctx) {
    const cam = this.cam;
    ctx.fillStyle = '#0e325c';
    ctx.fillRect(0, 0, game.w, game.h);
    ctx.save();
    cam.apply(ctx);
    this.terrain.draw(ctx);

    for (const g of this.geysers) {
      const col = g.owner >= 0 ? this.nations[g.owner].color : '#ddd';
      ctx.fillStyle = 'rgba(120,40,20,0.6)'; ctx.beginPath(); ctx.arc(g.x, g.y, 24, 0, TAU); ctx.fill();
      for (let i = 0; i < 5; i++) {
        const t = (this.t * 1.5 + i / 5) % 1;
        ctx.fillStyle = `rgba(255,${120 + i * 20},60,${1 - t})`;
        ctx.beginPath(); ctx.arc(g.x + Math.sin(i * 3 + this.t) * 5, g.y - t * 40, 5 + t * 6, 0, TAU); ctx.fill();
      }
      if (g.owner >= 0) {
        ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.strokeRect(g.x - 16, g.y - 16, 32, 32);
        ctx.beginPath(); ctx.moveTo(g.x - 16, g.y + 16); ctx.lineTo(g.x, g.y - 26); ctx.lineTo(g.x + 16, g.y + 16); ctx.stroke();
      }
      if (g.claim > 0) drawBar(ctx, g.x, g.y + 28, 40, g.claim / 4, '#fd4');
    }

    for (const c of this.cities) this.drawCity(ctx, c);

    if (this.shot) for (const s of this.shot) {
      ctx.strokeStyle = s.col || '#ff4'; ctx.lineWidth = 3; ctx.globalAlpha = s.t / 0.15;
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const v of this.vehicles) {
      if (!cam.visible(v.x, v.y, 30)) continue;
      const col = this.nations[v.owner].color;
      if (this.sel.has(v)) { ctx.strokeStyle = '#8f8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 8, 0, TAU); ctx.stroke(); }
      ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-12, -9, 28, 22);
      if (v.kind === 'tank') {
        ctx.fillStyle = '#333'; ctx.fillRect(-15, -12, 30, 6); ctx.fillRect(-15, 6, 30, 6);
        ctx.fillStyle = col; ctx.fillRect(-13, -8, 26, 16);
        ctx.fillStyle = '#222'; ctx.fillRect(0, -2, 20, 4);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-1, 0, 5, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-14, -9, 28, 18, 8); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
      }
      if (v.hurt > 0) { ctx.fillStyle = `rgba(255,50,50,${v.hurt * 0.5})`; ctx.fillRect(-15, -12, 30, 24); }
      ctx.restore();
      if (v.hp < v.maxHp) drawBar(ctx, v.x, v.y - 24, 30, v.hp / v.maxHp);
    }

    this.px.draw(ctx);
    this.fl.draw(ctx, cam.zoom);
    ctx.restore();
    this.selector.draw(ctx);
    this.drawMinimap();
  }

  drawCity(ctx, c) {
    const n = c.owner >= 0 ? this.nations[c.owner] : null;
    const col = n ? n.color : '#bbb';
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(80,80,80,0.35)'; ctx.beginPath(); ctx.arc(0, 0, c.r + 10, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, c.r + 10, 0, TAU); ctx.stroke();
    const r = mulberry32(Math.floor(c.x * 7 + c.y));
    const count = 8 + c.level * 5;
    for (let i = 0; i < count; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * c.r * 0.9;
      const x = Math.cos(a) * d, y = Math.sin(a) * d, s = r.range(8, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - s / 2 + 3, y - s / 2 + 3, s, s);
      ctx.fillStyle = '#e8e2d4'; ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.fillStyle = col; ctx.fillRect(x - s / 2, y - s / 2, s, s * 0.4);
    }
    if (c.capital) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (n) drawCreature(ctx, n.design, c.x, c.y - c.r - 30, -Math.PI / 2, 0.45, { shadow: false });
    ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const label = c.name + (c.owner === 0 ? ' ★' : '');
    ctx.strokeText(label, c.x, c.y + c.r + 32); ctx.fillStyle = '#fff'; ctx.fillText(label, c.x, c.y + c.r + 32);
    if (c.owner !== 0) {
      drawBar(ctx, c.x, c.y + c.r + 38, 80, c.def / c.maxDef, '#f66');
      drawBar(ctx, c.x, c.y + c.r + 45, 80, c.faith / 100, '#ffd84a');
    } else if (c.def < c.maxDef) drawBar(ctx, c.x, c.y + c.r + 38, 80, c.def / c.maxDef);
  }

  drawMinimap() {
    const c = this.mini.getContext('2d');
    const S = 150, k = S / SIZE;
    c.clearRect(0, 0, S, S);
    this.terrain.drawMini(c, 0, 0, S);
    for (const g of this.geysers) { c.fillStyle = g.owner >= 0 ? this.nations[g.owner].color : '#fa6'; c.fillRect(g.x * k - 2, g.y * k - 2, 4, 4); }
    for (const ci of this.cities) {
      c.fillStyle = ci.owner >= 0 ? this.nations[ci.owner].color : '#bbb';
      c.beginPath(); c.arc(ci.x * k, ci.y * k, 5, 0, TAU); c.fill();
      c.strokeStyle = ci.owner === 0 ? '#fff' : '#000'; c.lineWidth = 1.5; c.stroke();
    }
    for (const v of this.vehicles) { c.fillStyle = v.owner === 0 ? '#ff0' : this.nations[v.owner].color; c.fillRect(v.x * k - 1, v.y * k - 1, 2, 2); }
    const cam = this.cam;
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.strokeRect((cam.x - game.w / 2 / cam.zoom) * k, (cam.y - game.h / 2 / cam.zoom) * k, game.w / cam.zoom * k, game.h / cam.zoom * k);
  }
}

const CITY_A = ['ノ', 'ア', 'ル', 'ミ', 'カ', 'ト', 'ベ', 'ラ', 'シ', 'オ', 'ユ', 'ネ'];
const CITY_B = ['ポリス', 'ヴィル', 'ブルク', 'ランド', 'ハイム', 'シティ'];
function cityName(r) { return r.pick(CITY_A) + r.pick(CITY_A) + r.pick(CITY_B); }
