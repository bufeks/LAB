// Space stage: a galaxy map. Warp between stars, colonise and terraform,
// deal with rival empires and pirates, and finally reach the galactic core.

import { game } from './game.js';
import { ui, Floaters, Particles } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, lerp, rng, mulberry32, Camera, hsl, fmt } from './util.js';
import { drawCreature, randomDesign } from './creature.js';
import { TRAITS } from './save.js';

const R = 2300;
const CORE_R = 650;
const UPG = {
  range: { name: 'ワープエンジン', desc: '航続距離アップ', cost: [500, 1000, 1800, 3000] },
  energy: { name: 'エネルギータンク', desc: '最大エネルギーアップ', cost: [400, 900, 1600, 2800] },
  weapon: { name: 'レーザー砲', desc: '攻撃力アップ', cost: [500, 1000, 1800, 3000] },
  hull: { name: '装甲', desc: '船体の耐久力アップ', cost: [400, 800, 1500, 2500] },
};
const PT = ['T0 不毛', 'T1 住める', 'T2 快適', 'T3 楽園'];
const SPICE = [{ n: '赤スパイス', c: '#ff5a4a', v: 1 }, { n: '青スパイス', c: '#4aa0ff', v: 1.4 }, { n: '紫スパイス', c: '#b45aff', v: 2 }];

export class SpaceScene {
  constructor() {
    const s = game.save;
    this.seed = (s.world?.seed || 1) + 303;
    this.cam = new Camera();
    this.cam.zoom = 0.5;
    this.fl = new Floaters();
    this.px = new Particles();
    this.t = 0;
    this.design = s.creatureDesign;
    const tr = s.traits.civ;
    this.dipMul = tr === 'social' ? 0.6 : 1;
    this.atkMul = tr === 'aggressive' ? 1.5 : 1;
    this.incMul = tr === 'mixed' ? 1.4 : 1;
    this.money = 1500;
    this.up = { range: 0, energy: 0, weapon: 0, hull: 0 };
    this.build();
    this.ship = { star: this.home, x: this.home.x, y: this.home.y, energy: this.maxEnergy, hp: this.maxHp, travel: null, rot: 0 };
    this.cam.x = this.home.x; this.cam.y = this.home.y;
    this.focus = null;
    this.battle = null;
    this.raid = null;
    this.raidT = 90;
    this.dust = makeDust(this.seed);
  }

  get range() { return 300 + this.up.range * 110; }
  get maxEnergy() { return 100 + this.up.energy * 50; }
  get maxHp() { return 100 + this.up.hull * 60; }
  get dmg() { return (14 + this.up.weapon * 12) * this.atkMul; }

  build() {
    const r = mulberry32(this.seed);
    this.stars = [];
    const arms = 4;
    let tries = 0;
    while (this.stars.length < 170 && tries++ < 5000) {
      const u = r();
      const rad = 380 + Math.sqrt(u) * (R - 380);
      const arm = r.int(0, arms - 1);
      const a = arm / arms * TAU + rad * 0.0022 + r.range(-0.35, 0.35) * (1.2 - rad / R);
      const x = Math.cos(a) * rad + r.range(-60, 60), y = Math.sin(a) * rad + r.range(-60, 60);
      if (this.stars.some((s) => Math.hypot(s.x - x, s.y - y) < 85)) continue;
      const hue = r.pick([0, 30, 50, 55, 200, 220]);
      const planets = [];
      const np = r.int(1, 4);
      for (let i = 0; i < np; i++) {
        const tp = r() < 0.4 ? 0 : r() < 0.6 ? 1 : r() < 0.75 ? 2 : 3;
        planets.push({ type: tp, spice: r.pick(SPICE), colony: false, hue: r.int(0, 359), size: r.range(0.6, 1.3), name: '' });
      }
      const st = { id: this.stars.length, x, y, hue, size: r.range(3, 7), planets, owner: -1, known: false, def: 0, maxDef: 0, name: starName(r) };
      st.planets.forEach((p, i) => { p.name = st.name + ' ' + ['I', 'II', 'III', 'IV'][i]; });
      this.stars.push(st);
    }
    // home: an outer star
    const outer = this.stars.filter((s) => Math.hypot(s.x, s.y) > R * 0.8);
    this.home = r.pick(outer.length ? outer : this.stars);
    this.home.owner = 0;
    this.home.known = true;
    this.home.planets[0] = { type: 3, spice: SPICE[0], colony: true, hue: this.design.hue, size: 1.2, name: this.design.name + '星', homeworld: true };
    // empires
    const sps = (game.save.species || []).filter((x) => x.design);
    this.empires = [];
    const names = ['グロックス', 'ティルキ', 'ヴェロン', 'ズルバ'];
    for (let i = 0; i < 4; i++) {
      const d = sps[i + 3]?.design || randomDesign(r.int(1, 1e9), 'creature', r.pick(['herb', 'carn', 'omni']), 2.5);
      const emp = { id: i + 1, name: names[i] + '帝国', design: d, color: hsl((i * 90 + 40) % 360, 80, 60), relation: r.int(20, 50), war: false, ally: false };
      // capital: a free star at mid radius, away from home and other capitals
      let cap = null;
      for (let k = 0; k < 400; k++) {
        const c = r.pick(this.stars);
        const cr = Math.hypot(c.x, c.y);
        if (c.owner === -1 && cr > 700 && cr < R * 0.85 && Math.hypot(c.x - this.home.x, c.y - this.home.y) > 900 && this.empires.every((e) => Math.hypot(e.cap.x - c.x, e.cap.y - c.y) > 900)) { cap = c; break; }
      }
      if (!cap) cap = this.stars.find((c) => c.owner === -1);
      emp.cap = cap;
      const near = this.stars.filter((s) => s.owner === -1).sort((a, b) => Math.hypot(a.x - cap.x, a.y - cap.y) - Math.hypot(b.x - cap.x, b.y - cap.y)).slice(0, 7);
      for (const s of near) { s.owner = emp.id; s.def = s.maxDef = s === cap ? 400 : 160; }
      this.empires.push(emp);
    }
    // pirates hide in a few stars
    for (let i = 0; i < 6; i++) { const s = r.pick(this.stars); if (s.owner === -1) s.pirates = 60 + r.int(0, 60); }
    this.core = { x: 0, y: 0, core: true, name: '銀河の中心' };
  }

  empireOf(st) { return st.owner > 0 ? this.empires[st.owner - 1] : null; }

  income() {
    let inc = 0;
    for (const s of this.stars) if (s.owner === 0) for (const p of s.planets) if (p.colony) inc += (p.type * 1.6 + 1) * p.spice.v;
    return inc * this.incMul;
  }

  travelCost(a, b) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const inner = Math.min(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y)) < CORE_R;
    return Math.ceil(d * 0.1 * (inner ? 2.6 : 1) * (b.core ? 1.6 : 1));
  }

  // ------------------------------------------------------------------ HUD
  enter() {
    const top = ui.el('div', 'hud top-left');
    ui.el('div', 'stage-name', top, '宇宙期');
    this.resEl = ui.el('div', 'res', top);
    this.enBar = ui.meter(top, 'エネルギー', 'food');
    this.hpBar = ui.meter(top, '船体', 'hp');
    const right = ui.el('div', 'hud top-right');
    ui.button('🏠 母星へカメラ', 'small', () => { this.cam.x = this.ship.x; this.cam.y = this.ship.y; }, right);
    ui.button('⏸', 'small', () => game.go('title'), right).title = 'タイトルへ';
    this.empList = ui.el('div', 'panel species-list', right);
    this.info = ui.el('div', 'panel star-panel', ui.root);
    this.raidEl = ui.el('div', 'raid hidden', ui.root);
    this.refreshList();
    this.showStar(this.ship.star);
    ui.modal('宇宙期', `
      <p>ついに宇宙船が完成した！　パイロットはもちろん <b>${this.design.name}</b>。</p>
      <ul>
        <li><b>星をクリック</b> → 範囲内（点線の円）なら「ワープ」。エネルギーを使う</li>
        <li>着いた星で惑星に <b>植民</b>・<b>テラフォーム</b> すると収入（§）が増える</li>
        <li>自分の星ではエネルギーが満タンに。お金で船を <b>アップグレード</b></li>
        <li>帝国とは <b>交易・同盟</b> も <b>攻撃</b> もできる。海賊の襲撃にも注意</li>
        <li>最終目標: <b>銀河の中心</b> にたどり着くこと！</li>
      </ul>
      <p class="hint">あなたの進化の歩み: ${['cell', 'creature', 'tribe', 'civ'].map((k) => game.save.traits[k] ? TRAITS[k][game.save.traits[k]]?.name : '').filter(Boolean).join(' → ')}</p>`,
    [{ label: '出発！', cls: 'primary' }]);
  }

  refreshList() {
    let h = '<h3>帝国</h3>';
    for (const e of this.empires) {
      const n = this.stars.filter((s) => s.owner === e.id).length;
      const st = !n ? '<span class="ok">滅亡</span>' : e.ally ? '<span class="ok">同盟</span>' : e.war ? '<span class="bad">戦争</span>' : `友好 ${Math.round(e.relation)}`;
      h += `<div class="sp"><i style="background:${e.color}"></i>${e.name}<span>⭐${n} ${st}</span></div>`;
    }
    const mine = this.stars.filter((s) => s.owner === 0).length;
    h += `<div class="sp"><i style="background:${hsl(this.design.hue, 75, 55)}"></i>あなた<span>⭐${mine}</span></div>`;
    this.empList.innerHTML = h;
  }

  showStar(st) {
    this.focus = st;
    const sh = this.ship;
    const here = sh.star === st && !sh.travel;
    const box = this.info;
    box.innerHTML = '';
    if (st.core) {
      const cost = this.travelCost(sh.star, st);
      const d = Math.hypot(sh.star.x, sh.star.y);
      ui.el('h3', '', box, '🌀 銀河の中心');
      ui.el('p', '', box, 'すべての生命が還る場所。強い重力のため、近づくほどエネルギーを多く使う。');
      ui.el('p', '', box, `距離 ${Math.round(d)} / 航続 ${this.range}　必要エネルギー ${cost}`);
      const b = ui.button('🚀 中心へワープ', 'primary', () => this.warp(st), box);
      if (d > this.range || cost > sh.energy) b.classList.add('dim');
      return;
    }
    const emp = this.empireOf(st);
    const owner = st.owner === 0 ? 'あなたの星系' : emp ? emp.name : st.known ? '無所属' : '未探査';
    ui.el('h3', '', box, `⭐ ${st.name} <small>${owner}</small>`);
    if (!here) {
      const d = Math.hypot(st.x - sh.star.x, st.y - sh.star.y);
      const cost = this.travelCost(sh.star, st);
      ui.el('p', '', box, `距離 ${Math.round(d)}（航続 ${this.range}）　必要エネルギー ${cost}`);
      const b = ui.button('🚀 ワープ', 'primary', () => this.warp(st), box);
      if (d > this.range) { b.classList.add('dim'); ui.el('p', 'hint', box, '遠すぎる — ワープエンジンを強化しよう'); }
      else if (cost > sh.energy) { b.classList.add('dim'); ui.el('p', 'hint', box, 'エネルギー不足 — 自分の星で補給しよう'); }
      if (st.known) this.planetList(box, st, false);
      return;
    }

    // we are here
    if (st.pirates) {
      ui.el('p', 'bad', box, `☠ 海賊の拠点がある！（戦力 ${st.pirates}）`);
      ui.button('⚔ 海賊と戦う', 'danger', () => this.startBattle({ kind: 'pirates', st, hp: st.pirates, max: st.pirates }), box);
    }
    if (emp) {
      ui.el('p', '', box, `友好度 ${Math.round(emp.relation)} / 100 ${emp.ally ? '<span class="ok">同盟</span>' : emp.war ? '<span class="bad">戦争中</span>' : ''}　防衛 ${Math.round(st.def)}`);
      const row = ui.el('div', 'btn-row', box);
      if (!emp.ally) {
        const tradeCost = Math.round(250 * this.dipMul);
        ui.button(`🤝 交易 (§${tradeCost})`, '', () => {
          if (emp.war) { ui.toast('戦争中は交易できない', 'bad'); return; }
          if (!this.pay(tradeCost)) return;
          emp.relation = Math.min(100, emp.relation + 18); sfx.good(); this.refreshList(); this.showStar(st);
          ui.toast(`${emp.name}との友好度が上がった`, 'good');
        }, row);
        const allyCost = Math.round(1200 * this.dipMul);
        const ab = ui.button(`🕊 同盟 (§${allyCost}・友好80以上)`, '', () => {
          if (emp.relation < 80) { ui.toast('まだ友好度が足りない', 'bad'); return; }
          if (!this.pay(allyCost)) return;
          emp.ally = true; emp.war = false; sfx.win(); this.refreshList(); this.showStar(st);
          ui.toast(`🕊 <b>${emp.name}</b> と同盟を結んだ！ 帝国の星でも補給できる`, 'good');
        }, row);
        if (emp.relation < 80) ab.classList.add('dim');
        ui.button('⚔ 攻撃', 'danger', () => {
          if (!emp.war) { emp.war = true; emp.relation = 0; ui.toast(`${emp.name} と戦争になった！`, 'bad'); this.refreshList(); }
          this.startBattle({ kind: 'empire', st, emp });
        }, row);
      }
    }
    if (st.owner === 0 || emp?.ally) {
      if (sh.energy < this.maxEnergy) { sh.energy = this.maxEnergy; ui.toast('⚡ エネルギーを補給した'); }
    }
    if (st.owner === 0) {
      const row = ui.el('div', 'btn-row', box);
      const rc = Math.ceil((this.maxHp - sh.hp) * 2);
      if (rc > 0) ui.button(`🔧 修理 (§${rc})`, '', () => { if (this.pay(rc)) { sh.hp = this.maxHp; this.showStar(st); } }, row);
      ui.el('h4', '', box, '船のアップグレード');
      const ug = ui.el('div', 'upgrades', box);
      for (const k in UPG) {
        const lvl = this.up[k], u = UPG[k];
        const cost = u.cost[lvl];
        const b = ui.button(`${u.name} Lv${lvl + 1}<small>${u.desc}${cost ? ` §${fmt(cost)}` : ' (最大)'}</small>`, 'small', () => {
          if (!cost || !this.pay(cost)) return;
          this.up[k]++;
          if (k === 'energy') sh.energy = this.maxEnergy;
          if (k === 'hull') sh.hp = this.maxHp;
          sfx.level();
          this.showStar(st);
        }, ug);
        if (!cost || this.money < cost) b.classList.add('dim');
      }
    } else if (!emp) {
      const cost = Math.max(10, Math.round((this.maxEnergy - sh.energy) * 3));
      if (sh.energy < this.maxEnergy) ui.button(`⚡ エネルギーを買う (§${cost})`, 'small', () => { if (this.pay(cost)) { sh.energy = this.maxEnergy; this.showStar(st); } }, box);
    }
    this.planetList(box, st, true);
  }

  planetList(box, st, here) {
    const list = ui.el('div', 'planets', box);
    for (const p of st.planets) {
      const row = ui.el('div', 'planet', list);
      const cv = ui.el('canvas', '', row);
      cv.width = cv.height = 44;
      drawPlanet(cv.getContext('2d'), 22, 22, 16 * p.size, p, this.t);
      const txt = ui.el('div', 'ptxt', row, `<b>${p.name}</b><br><small>${PT[p.type]}・<span style="color:${p.spice.c}">${p.spice.n}</span>${p.colony ? '・<span class="ok">植民地</span>' : ''}</small>`);
      if (!here || (st.owner > 0)) continue;
      if (!p.colony && p.type >= 1 && !st.pirates) {
        ui.button('🏠 植民 §300', 'small', () => {
          if (!this.pay(300)) return;
          p.colony = true; st.owner = 0; sfx.build();
          ui.toast(`🏠 ${p.name} に植民した！`, 'good');
          this.refreshList(); this.showStar(st);
        }, txt);
      }
      if (p.type < 3 && (p.colony || p.type === 0)) {
        const c = 250 + p.type * 200;
        ui.button(`🌱 テラフォーム §${c}`, 'small', () => {
          if (!this.pay(c)) return;
          p.type++; sfx.part();
          ui.toast(`🌱 ${p.name} が ${PT[p.type]} になった`, 'good');
          this.showStar(st);
        }, txt);
      }
    }
  }

  pay(n) {
    if (this.money < n) { ui.toast(`お金が足りません（§${fmt(n)}）`, 'bad'); sfx.bad(); return false; }
    this.money -= n;
    return true;
  }

  warp(st) {
    const sh = this.ship;
    if (sh.travel || this.battle) return;
    const d = Math.hypot(st.x - sh.star.x, st.y - sh.star.y);
    const cost = this.travelCost(sh.star, st);
    if (d > this.range) { ui.toast('航続距離が足りない', 'bad'); sfx.bad(); return; }
    if (cost > sh.energy) { ui.toast('エネルギーが足りない', 'bad'); sfx.bad(); return; }
    sh.energy -= cost;
    sh.travel = { from: sh.star, to: st, t: 0, dur: 0.6 + d / 900 };
    sh.rot = Math.atan2(st.y - sh.y, st.x - sh.x);
    sfx.warp();
    this.info.innerHTML = '<h3>ワープ中…</h3>';
  }

  arrive(st) {
    const sh = this.ship;
    sh.star = st;
    if (st.core) { this.win(); return; }
    if (!st.known) {
      st.known = true;
      this.money += 40;
      this.fl.add(st.x, st.y - 30, '+§40 探査', '#9ef0ff', 16);
    }
    const emp = this.empireOf(st);
    if (emp && !emp.ally && !emp.met) {
      emp.met = true;
      ui.toast(`👽 <b>${emp.name}</b> と出会った！`, '');
      const m = ui.modal(emp.name, `<canvas width="160" height="120"></canvas><p>「${emp.war ? 'よく来たな、侵略者め！' : emp.relation > 40 ? 'ようこそ、旅の者よ。' : '我々の領域に何の用だ？'}」</p>`, [{ label: 'OK' }]);
      drawCreature(m.querySelector('canvas').getContext('2d'), emp.design, 80, 64, -Math.PI / 2, 1.3, { shadow: false });
    }
    if (this.raid && this.raid.st === st) {
      this.startBattle({ kind: 'raid', st, hp: this.raid.power, max: this.raid.power });
      return;
    }
    this.showStar(st);
  }

  startBattle(b) {
    if (this.battle) return;
    if (b.kind === 'empire') { b.hp = b.st.def; b.max = b.st.maxDef; }
    b.cd = 0;
    this.battle = b;
    this.info.innerHTML = '<h3>⚔ 戦闘中！</h3><p>自動で撃ち合っています…</p>';
    const btn = ui.button('🏃 撤退', 'small', () => { this.battle = null; this.showStar(this.ship.star); }, this.info);
    btn.style.marginTop = '8px';
  }

  updateBattle(dt) {
    const b = this.battle;
    const sh = this.ship;
    b.cd -= dt;
    if (b.cd > 0) return;
    b.cd = 0.45;
    const dmg = this.dmg * (0.8 + rng() * 0.4);
    b.hp -= dmg;
    if (b.kind === 'empire') b.st.def = Math.max(0, b.hp);
    const a = rng() * TAU;
    this.beams.push({ x0: sh.x, y0: sh.y, x1: b.st.x + Math.cos(a) * 20, y1: b.st.y + Math.sin(a) * 20, t: 0.2, col: '#7ff' });
    this.fl.add(b.st.x, b.st.y - 20, '-' + Math.round(dmg), '#ffd36b', 14);
    sfx.laser();
    const enemyDmg = b.kind === 'empire' ? (b.st === b.emp.cap ? 11 : 7) : 6;
    sh.hp -= enemyDmg * (0.7 + rng() * 0.6);
    this.beams.push({ x0: b.st.x, y0: b.st.y, x1: sh.x + rng.range(-10, 10), y1: sh.y + rng.range(-10, 10), t: 0.2, col: '#f66' });
    if (sh.hp <= 0) {
      sh.hp = this.maxHp * 0.5;
      this.battle = null;
      sh.star = this.home; sh.x = this.home.x; sh.y = this.home.y;
      sh.energy = this.maxEnergy;
      this.money = Math.floor(this.money * 0.8);
      sfx.die();
      ui.toast('船が大破！母星に緊急帰還した（資金の20%を失った）', 'bad');
      this.showStar(this.home);
      return;
    }
    if (b.hp <= 0) {
      this.battle = null;
      sfx.win();
      if (b.kind === 'pirates') {
        b.st.pirates = 0; this.money += 400;
        ui.toast('☠ 海賊を倒した！ §400 を手に入れた', 'good');
      } else if (b.kind === 'raid') {
        this.raid = null; this.raidEl.classList.add('hidden'); this.money += 250;
        ui.toast('🛡 襲撃を撃退した！ §250', 'good');
      } else {
        const st = b.st;
        const wasCap = st === b.emp.cap;
        st.owner = 0; st.def = 0;
        for (const p of st.planets) if (p.type >= 1) p.colony = true;
        ui.toast(`⭐ <b>${st.name}</b> を奪った！`, 'good');
        if (wasCap) { this.money += 1500; ui.toast(`${b.emp.name} の首都を落とした！ §1500`, 'good'); }
        this.refreshList();
      }
      this.showStar(this.ship.star);
    }
  }

  win() {
    const s = game.save;
    s.stage = 'done';
    if (!s.reached.includes('done')) s.reached.push('done');
    s.spaceStats = { stars: this.stars.filter((x) => x.owner === 0).length, money: Math.floor(this.money) };
    game.persist();
    sfx.win();
    game.go('ending');
  }

  update(dt) {
    const inp = game.input;
    const cam = this.cam;
    const sh = this.ship;
    this.t += dt;
    game.save.stats.time += dt;
    cam.w = game.w; cam.h = game.h;
    this.beams = this.beams || [];

    // pan (mouse drag or arrows), zoom
    if (inp.drag) {
      if (this.lastDrag) { cam.x -= (inp.drag.x - this.lastDrag.x) / cam.zoom; cam.y -= (inp.drag.y - this.lastDrag.y) / cam.zoom; }
      this.lastDrag = { x: inp.drag.x, y: inp.drag.y };
    } else this.lastDrag = null;
    const pan = 700 / cam.zoom * dt;
    if (inp.isDown('ArrowLeft', 'KeyA')) cam.x -= pan;
    if (inp.isDown('ArrowRight', 'KeyD')) cam.x += pan;
    if (inp.isDown('ArrowUp', 'KeyW')) cam.y -= pan;
    if (inp.isDown('ArrowDown', 'KeyS')) cam.y += pan;
    if (inp.wheel) cam.zoom = clamp(cam.zoom * (inp.wheel > 0 ? 0.88 : 1.12), 0.15, 2);
    cam.x = clamp(cam.x, -R, R); cam.y = clamp(cam.y, -R, R);

    for (const c of inp.clicks) {
      const w = cam.toWorld(c.x, c.y);
      let best = null, bd = 26 / cam.zoom;
      for (const st of this.stars) { const d = Math.hypot(st.x - w.x, st.y - w.y); if (d < bd) { bd = d; best = st; } }
      if (!best && Math.hypot(w.x, w.y) < 90) best = this.core;
      if (best) { sfx.click(); if (!sh.travel && !this.battle) this.showStar(best); else this.focus = best; }
    }

    // travel
    if (sh.travel) {
      const tr = sh.travel;
      tr.t += dt / tr.dur;
      const e = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - (-2 * tr.t + 2) ** 2 / 2;
      sh.x = lerp(tr.from.x, tr.to.x, e); sh.y = lerp(tr.from.y, tr.to.y, e);
      if (rng() < 0.8) this.px.burst(sh.x, sh.y, '#9ef', 1, 20, 0.6, 2);
      cam.x = lerp(cam.x, sh.x, dt * 4); cam.y = lerp(cam.y, sh.y, dt * 4);
      if (tr.t >= 1) { sh.travel = null; sh.x = tr.to.x; sh.y = tr.to.y; this.arrive(tr.to); }
    }
    if (this.battle) this.updateBattle(dt);

    // economy
    this.money += this.income() * dt;

    // empires at war harass your colonies; pirates raid
    this.raidT -= dt;
    const owned = this.stars.filter((s) => s.owner === 0 && s !== this.home);
    if (!this.raid && this.raidT <= 0 && owned.length) {
      this.raidT = rng.range(70, 120);
      const st = rng.pick(owned);
      const warEmp = this.empires.find((e) => e.war && this.stars.some((s) => s.owner === e.id));
      this.raid = { st, t: 50, power: 80 + owned.length * 15, by: warEmp ? warEmp.name : '宇宙海賊' };
      sfx.bad();
      ui.toast(`🚨 <b>${this.raid.by}</b> が ${st.name} を襲撃中！50秒以内に駆けつけよう`, 'bad');
    }
    if (this.raid) {
      const r = this.raid;
      if (!(this.battle && this.battle.kind === 'raid')) r.t -= dt;
      this.raidEl.classList.remove('hidden');
      this.raidEl.innerHTML = `🚨 ${r.by} が <b>${r.st.name}</b> を襲撃中！ 残り ${Math.ceil(r.t)}秒`;
      if (r.t <= 0) {
        const col = r.st.planets.filter((p) => p.colony);
        if (col.length) col[col.length - 1].colony = false;
        if (!r.st.planets.some((p) => p.colony)) r.st.owner = -1;
        ui.toast(`💥 ${r.st.name} の植民地が破壊された…`, 'bad');
        this.raid = null;
        this.raidEl.classList.add('hidden');
        this.refreshList();
      }
    }
    // relations drift up slowly when at peace
    for (const e of this.empires) if (!e.war && !e.ally) e.relation = Math.min(79, e.relation + dt * 0.05);

    for (const b of this.beams) b.t -= dt;
    this.beams = this.beams.filter((b) => b.t > 0);
    this.fl.update(dt);
    this.px.update(dt);

    this.resEl.innerHTML = `💰 <b>§${fmt(this.money)}</b> <small>(+${this.income().toFixed(1)}/秒)</small>`;
    this.enBar(sh.energy / this.maxEnergy, Math.round(sh.energy) + ' / ' + this.maxEnergy);
    this.hpBar(sh.hp / this.maxHp, Math.round(sh.hp) + ' / ' + this.maxHp);
    if ((this.listT = (this.listT || 0) - dt) <= 0) {
      this.listT = 2; this.refreshList();
      // keep upgrade buttons' affordability fresh
      if (!sh.travel && !this.battle && this.focus === sh.star && sh.star.owner === 0) this.showStar(sh.star);
    }
  }

  draw(ctx) {
    const cam = this.cam;
    const sh = this.ship;
    ctx.fillStyle = '#03030a';
    ctx.fillRect(0, 0, game.w, game.h);
    ctx.save();
    cam.apply(ctx);

    // galaxy glow
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
    g.addColorStop(0, 'rgba(255,230,190,0.55)');
    g.addColorStop(0.15, 'rgba(200,150,255,0.18)');
    g.addColorStop(0.6, 'rgba(80,90,200,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.1, 0, TAU); ctx.fill();
    ctx.drawImage(this.dust, -R * 1.1, -R * 1.1, R * 2.2, R * 2.2);

    // core
    ctx.save();
    ctx.rotate(this.t * 0.3);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(255,220,160,${0.5 - i * 0.12})`; ctx.lineWidth = 8 - i * 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 60 + i * 25, 30 + i * 14, i, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,60,0.2)'; ctx.setLineDash([10, 14]); ctx.lineWidth = 2 / cam.zoom;
    ctx.beginPath(); ctx.arc(0, 0, CORE_R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);

    // range
    if (!sh.travel) {
      ctx.strokeStyle = 'rgba(120,255,200,0.5)'; ctx.lineWidth = 1.5 / cam.zoom; ctx.setLineDash([8 / cam.zoom, 8 / cam.zoom]);
      ctx.beginPath(); ctx.arc(sh.star.x, sh.star.y, this.range, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.focus && this.focus !== sh.star) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5 / cam.zoom;
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(this.focus.x, this.focus.y); ctx.stroke();
    }

    const k = 1 / Math.max(cam.zoom, 0.35);
    for (const st of this.stars) {
      if (!cam.visible(st.x, st.y, 60)) continue;
      const col = hsl(st.hue, 90, 75);
      const rr = st.size * k * 0.9;
      const glow = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, rr * 4);
      glow.addColorStop(0, col); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(st.x, st.y, rr * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(st.x, st.y, rr, 0, TAU); ctx.fill();
      if (st.owner >= 0) {
        const oc = st.owner === 0 ? hsl(this.design.hue, 80, 60) : this.empires[st.owner - 1].color;
        ctx.strokeStyle = oc; ctx.lineWidth = 3 * k;
        ctx.beginPath(); ctx.arc(st.x, st.y, rr + 8 * k, 0, TAU); ctx.stroke();
      }
      if (st.pirates && st.known) { ctx.font = `${14 * k}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('☠', st.x + 14 * k, st.y - 10 * k); }
      if (this.raid?.st === st) { ctx.strokeStyle = `rgba(255,60,60,${0.5 + 0.5 * Math.sin(this.t * 8)})`; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.arc(st.x, st.y, rr + 16 * k, 0, TAU); ctx.stroke(); }
      if (st === this.focus) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(st.x, st.y, rr + 14 * k, 0, TAU); ctx.stroke(); }
      if (cam.zoom > 0.45 || st.owner === 0 || st === this.home) {
        ctx.font = `${11 * k}px system-ui`; ctx.textAlign = 'center';
        ctx.fillStyle = st.known ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
        ctx.fillText(st.known ? st.name : '？', st.x, st.y + rr + 18 * k);
      }
    }

    for (const b of this.beams) {
      ctx.strokeStyle = b.col; ctx.lineWidth = 2.5 * k; ctx.globalAlpha = b.t / 0.2;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.px.draw(ctx);

    // the ship, piloted by our creature
    drawShip(ctx, this.design, sh.x + (sh.travel ? 0 : 18 * k), sh.y - (sh.travel ? 0 : 18 * k), 1.1 * k, this.t);
    this.fl.draw(ctx, cam.zoom);
    ctx.restore();
  }
}

function drawShip(ctx, d, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 2) * 2 * s);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(160,255,255,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 10, 12, 4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#9aa4b8'; ctx.strokeStyle = '#3d4455'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(0, 2, 22, 7, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = hsl(d.hue, 70, 55);
  for (let i = 0; i < 5; i++) { const a = t * 3 + i / 5 * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * 16, 3 + Math.sin(a) * 4, 1.8, 0, TAU); ctx.fill(); }
  // dome with the pilot
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, -2, 11, 11, 0, Math.PI, 0); ctx.closePath(); ctx.clip();
  ctx.fillStyle = 'rgba(180,230,255,0.5)'; ctx.fillRect(-12, -14, 24, 14);
  drawCreature(ctx, d, 0, -4, -Math.PI / 2, 0.22, { shadow: false, phase: t });
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, -2, 11, 11, 0, Math.PI, 0); ctx.stroke();
  ctx.restore();
}

function drawPlanet(ctx, x, y, r, p, t) {
  const base = [p.hue, p.hue, p.hue, p.hue];
  const col = p.type === 0 ? hsl(30, 15, 45) : p.type === 1 ? hsl(35, 40, 50) : p.type === 2 ? hsl(100, 40, 45) : hsl(140, 50, 45);
  ctx.clearRect(0, 0, x * 2, y * 2);
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#fff'); g.addColorStop(0.2, col); g.addColorStop(1, '#111');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  if (p.type >= 1) {
    ctx.fillStyle = p.type >= 2 ? 'rgba(60,120,220,0.55)' : 'rgba(60,120,220,0.25)';
    ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 0.1, r * 0.4, r * 0.25, 0.5, 0, TAU); ctx.fill();
  }
  if (p.colony) { ctx.fillStyle = '#ffe36a'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x - r * 0.3 + i * r * 0.2, y + r * 0.3 - (i % 2) * r * 0.3, 1.5, 0, TAU); ctx.fill(); } }
  void base; void t;
}

function makeDust(seed) {
  const r = mulberry32(seed);
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  for (let i = 0; i < 9000; i++) {
    const u = r();
    const rad = Math.sqrt(u) * S * 0.48;
    const arm = r.int(0, 3);
    const a = arm / 4 * TAU + rad / (S * 0.48) * R * 0.0022 + r.range(-0.5, 0.5) * (1.2 - rad / (S * 0.48));
    const x = S / 2 + Math.cos(a) * rad + r.range(-20, 20), y = S / 2 + Math.sin(a) * rad + r.range(-20, 20);
    c.fillStyle = `hsla(${r.pick([220, 260, 30, 200])},70%,${r.range(60, 90)}%,${r.range(0.1, 0.5)})`;
    c.fillRect(x, y, r.range(0.6, 1.8), r.range(0.6, 1.8));
  }
  return cv;
}

const SN_A = ['アル', 'ベ', 'シグ', 'デネ', 'エル', 'フォ', 'ガ', 'ヘリ', 'イオ', 'カ', 'リゲ', 'ミラ', 'ノヴァ', 'オリ', 'ポラ', 'ラス', 'スピ', 'ティ', 'ヴェガ', 'ゼ'];
const SN_B = ['ル', 'ナ', 'ス', 'ト', 'ン', 'ラ', 'キ', 'ロ', 'ア', 'マ'];
function starName(r) { return r.pick(SN_A) + r.pick(SN_B) + (r() < 0.3 ? '-' + r.int(2, 99) : ''); }
