// Tribal stage: a small real-time strategy. Gather food, grow the tribe,
// then win over (gifts, music) or conquer the neighbouring tribes.

import { game } from './game.js';
import { ui, Floaters, Particles } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, lerp, rng, mulberry32, turnTowards, Camera, hsl, fmt } from './util.js';
import { computeStats, drawCreature, randomDesign, designRadius } from './creature.js';
import { Terrain } from './terrain.js';
import { Selector, separate, drawBar } from './rts.js';
import { classify } from './save.js';

const SIZE = 3000;
const UNIT_SCALE = 0.55;
const COST_UNIT = 30, COST_HUT = 90, COST_GIFT = 25;

export class TribeScene {
  constructor() {
    const s = game.save;
    this.seed = (s.world?.seed || 1) + 101;
    this.terrain = new Terrain(SIZE, this.seed);
    this.cam = new Camera();
    this.cam.zoom = 1.1;
    this.fl = new Floaters();
    this.px = new Particles();
    this.sel = new Set();
    this.selector = new Selector();
    this.t = 0;
    this.food = 60;
    this.design = s.creatureDesign;
    this.stats = computeStats(this.design);
    const trait = s.traits.creature;
    this.socialMul = trait === 'social' ? 1.5 : 1;
    this.atkMul = trait === 'aggressive' ? 1.4 : 1;
    this.hpMul = trait === 'mixed' ? 1.3 : 1;
    this.panel = null;
    this.build();
  }

  build() {
    const r = mulberry32(this.seed);
    const T = this.terrain;
    let home = T.randomLand(r, 0.4, 0.55);
    for (let i = 0; i < 40; i++) {
      const p = T.randomLand(r, 0.4, 0.55);
      if (Math.hypot(p.x - SIZE / 2, p.y - SIZE / 2) < Math.hypot(home.x - SIZE / 2, home.y - SIZE / 2)) home = p;
    }
    this.tribes = [];
    const me = { id: 0, name: this.design.name + '族', design: this.design, hut: this.makeHut(home.x, home.y, 0), me: true, color: hsl(this.design.hue, 70, 55), level: 1 };
    this.tribes.push(me);

    // Neighbours are the species we met on the island (survivors first).
    const sps = (game.save.species || []).filter((x) => x.design);
    sps.sort((a, b) => (a.fate === 'extinct') - (b.fate === 'extinct'));
    for (let i = 0; i < 4; i++) {
      const sp = sps[i];
      const design = sp && sp.fate !== 'extinct' ? sp.design : randomDesign(r.int(1, 1e9), 'creature', r.pick(['herb', 'carn', 'omni']), 1.5);
      let p;
      for (let k = 0; k < 300; k++) {
        p = T.randomLand(r, 0.38, 0.6);
        if (Math.hypot(p.x - home.x, p.y - home.y) > 700 && this.tribes.every((t) => Math.hypot(t.hut.x - p.x, t.hut.y - p.y) > 550)) break;
      }
      const st = computeStats(design);
      const friendly = sp?.fate === 'friend';
      const tr = {
        id: i + 1, name: design.name + '族', design, hut: this.makeHut(p.x, p.y, i + 1), color: hsl(design.hue, 70, 55),
        relation: friendly ? 55 : st.diet === 'carn' ? 15 : 35, state: 'neutral', raidT: r.range(70, 130),
        aggressive: st.diet === 'carn' || st.strike + st.charge > 1.5, food: 0,
      };
      this.tribes.push(tr);
    }
    this.units = [];
    for (let i = 0; i < 4; i++) this.spawnUnit(me);
    for (const tr of this.tribes.slice(1)) for (let i = 0; i < 4; i++) this.spawnUnit(tr);

    // resources
    this.bushes = [];
    for (let i = 0; i < 70; i++) {
      const p = T.randomLand(r, 0.34, 0.62);
      this.bushes.push({ x: p.x, y: p.y, food: 40, max: 40, r: 16 });
    }
    // make sure there's food near home
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU + 0.3;
      const x = home.x + Math.cos(a) * 220, y = home.y + Math.sin(a) * 220;
      if (T.isLand(x, y)) this.bushes.push({ x, y, food: 40, max: 40, r: 16 });
    }
    this.animals = [];
    const pool = sps.length ? sps.map((x) => x.design) : [randomDesign(5, 'creature', 'herb', 1)];
    for (let i = 0; i < 14; i++) {
      const p = T.randomLand(r, 0.35, 0.6);
      const d = pool[i % pool.length];
      for (let k = 0; k < 2; k++) this.animals.push(this.makeAnimal(d, p.x + k * 30, p.y));
    }
    this.carcasses = [];
    this.cam.x = home.x; this.cam.y = home.y;
  }

  makeHut(x, y, owner) { const hp = owner ? 450 : 300; return { x, y, owner, hp, maxHp: hp, r: 55, fire: rng() * 10 }; }

  makeAnimal(d, x, y) {
    return { design: d, x, y, rot: rng() * TAU, phase: 0, move: 0, hp: 45, maxHp: 45, r: designRadius(d) * 0.8, scale: 0.8, wanderT: 0, hurt: 0, animal: true };
  }

  spawnUnit(tr) {
    const a = rng() * TAU;
    const x = tr.hut.x + Math.cos(a) * 80, y = tr.hut.y + Math.sin(a) * 80;
    const mine = tr.id === 0;
    const hp = mine ? 45 * this.hpMul : 40;
    const u = {
      tribe: tr, x: this.terrain.isLand(x, y) ? x : tr.hut.x, y: this.terrain.isLand(x, y) ? y : tr.hut.y,
      rot: a, phase: rng() * 10, move: 0, hp, maxHp: hp, r: designRadius(tr.design) * UNIT_SCALE, cd: 0, hurt: 0,
      state: 'idle', target: null, carry: 0, act: 0, tool: rng.pick(['spear', 'axe', 'club']),
      speed: 70 + computeStats(tr.design).speed * 8, idleSpot: { x, y },
    };
    this.units.push(u);
    return u;
  }

  get myUnits() { return this.units.filter((u) => u.tribe.id === 0); }
  get popCap() { return 5 + this.tribes[0].level * 3 + this.tribes.filter((t) => t.state === 'conquered').length * 2; }

  // ------------------------------------------------------------------ HUD
  enter() {
    const top = ui.el('div', 'hud top-left');
    ui.el('div', 'stage-name', top, '部族期');
    this.resEl = ui.el('div', 'res', top);
    this.hutBar = ui.meter(top, '村', 'hp');

    const right = ui.el('div', 'hud top-right');
    this.nextBtn = ui.button('🏛 文明をひらく！', 'primary hidden', () => this.finish(), right);
    ui.button('⏸', 'small', () => game.go('title'), right).title = 'タイトルへ';
    this.tribeList = ui.el('div', 'panel species-list', right);

    const bottom = ui.el('div', 'hud bottom-center');
    const bar = ui.el('div', 'abilities', bottom);
    this.unitBtn = ui.button(`👶 部族員を生む <small>🍖${COST_UNIT}</small>`, '', () => this.buyUnit(), bar);
    this.hutBtn = ui.button(`🛖 村を大きく <small>🍖${COST_HUT}</small>`, '', () => this.upgradeHut(), bar);
    ui.button('👥 全員選択 [A]', '', () => { this.sel = new Set(this.myUnits); }, bar);
    ui.button('🍎 食料集め [G]', '', () => this.autoGather(), bar);
    this.selInfo = ui.el('div', 'sel-info', bottom);
    this.mini = ui.el('canvas', 'minimap', ui.root);
    this.mini.width = this.mini.height = 150;
    this.refreshList();
    ui.modal('部族期', `
      <p>知性を手に入れ、<b>${this.tribes[0].name}</b> が生まれた！　この島には他に4つの部族がいます。</p>
      <ul>
        <li><b>選択</b>: 仲間をクリック / ドラッグで範囲選択 / Aキーで全員</li>
        <li><b>命令</b>: 選択中に右クリック（スマホはタップ）— 茂みで採集、動物で狩り、敵で攻撃</li>
        <li><b>他の部族の小屋をクリック</b> すると「贈り物」「演奏」「攻撃」を選べる</li>
        <li>食料で部族員を増やそう。4部族すべてと <b>同盟</b> するか <b>征服</b> すると文明期へ！</li>
        <li>仲の悪い部族は村を襲ってくることがある</li>
      </ul>`, [{ label: 'はじめる', cls: 'primary' }]);
  }

  refreshList() {
    let h = '<h3>部族</h3>';
    for (const t of this.tribes.slice(1)) {
      const st = t.state === 'allied' ? '<span class="ok">同盟</span>' : t.state === 'conquered' ? '<span class="bad">征服</span>' : t.relation < 25 ? `<span class="bad">敵対 ${Math.round(t.relation)}</span>` : `友好度 ${Math.round(t.relation)}`;
      h += `<div class="sp"><i style="background:${t.color}"></i>${t.name}<span>${st}</span></div>`;
    }
    this.tribeList.innerHTML = h;
  }

  buyUnit() {
    if (this.myUnits.length >= this.popCap) { ui.toast(`人口の上限です（${this.popCap}）。村を大きくしよう`, 'bad'); return; }
    if (this.food < COST_UNIT) { ui.toast('食料が足りません', 'bad'); sfx.bad(); return; }
    this.food -= COST_UNIT;
    const u = this.spawnUnit(this.tribes[0]);
    this.px.burst(u.x, u.y, '#fff', 10, 60);
    sfx.build();
  }

  upgradeHut() {
    const me = this.tribes[0];
    if (me.level >= 3) { ui.toast('村はもう最大です', ''); return; }
    if (this.food < COST_HUT * me.level) { ui.toast(`食料が${COST_HUT * me.level}必要です`, 'bad'); sfx.bad(); return; }
    this.food -= COST_HUT * me.level;
    me.level++;
    me.hut.maxHp += 150; me.hut.hp = me.hut.maxHp; me.hut.r += 8;
    sfx.level();
    ui.toast(`🛖 村が大きくなった！ 人口上限 ${this.popCap}`, 'good');
  }

  autoGather() {
    const list = this.sel.size ? [...this.sel] : this.myUnits.filter((u) => u.state === 'idle');
    for (const u of list) {
      const b = this.nearestBush(u.x, u.y);
      if (b) { u.state = 'gather'; u.target = b; }
    }
  }

  nearestBush(x, y) {
    let best = null, bd = 1e9;
    for (const b of this.bushes) {
      if (b.food < 5) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  openTribePanel(tr) {
    this.panel?.close();
    if (tr.state === 'conquered') return;
    const n = this.sel.size;
    const m = ui.modal(tr.name, `
      <div class="tribe-card"><canvas width="120" height="90"></canvas>
      <div>友好度 <b>${Math.round(tr.relation)}</b> / 100<br>${tr.state === 'allied' ? '<span class="ok">同盟中</span>' : tr.relation < 25 ? '<span class="bad">敵対している</span>' : 'ようすを見ている'}<br>
      <small>選択中の部族員: ${n}人</small></div></div>
      <p class="hint">友好度を100にすると同盟。小屋を壊すと征服。</p>`,
    tr.state === 'allied' ? [{ label: '閉じる' }] : [
      { label: `🎁 贈り物 (🍖${COST_GIFT})`, onClick: () => this.gift(tr) },
      { label: `🎶 演奏しに行く (${n}人)`, onClick: () => this.command([...this.sel], 'perform', tr) },
      { label: `⚔ 攻撃する (${n}人)`, cls: 'danger', onClick: () => this.command([...this.sel], 'attack', tr.hut) },
      { label: '閉じる' },
    ]);
    const cv = m.querySelector('canvas');
    drawCreature(cv.getContext('2d'), tr.design, 60, 48, -Math.PI / 2, 1, { shadow: false });
    this.panel = m;
  }

  gift(tr) {
    if (this.food < COST_GIFT) { ui.toast('食料が足りません', 'bad'); sfx.bad(); return; }
    this.food -= COST_GIFT;
    this.changeRelation(tr, 14 * this.socialMul);
    this.fl.add(tr.hut.x, tr.hut.y - 60, '🎁 +' + Math.round(14 * this.socialMul), '#ffd6f0', 18);
    sfx.good();
  }

  changeRelation(tr, d) {
    if (tr.state !== 'neutral') return;
    tr.relation = clamp(tr.relation + d, 0, 100);
    if (tr.relation >= 100) {
      tr.state = 'allied';
      sfx.win();
      ui.toast(`🤝 <b>${tr.name}</b> と同盟を結んだ！`, 'good');
      for (const u of this.units) if (u.tribe === tr && u.state === 'attack') u.state = 'idle';
      for (const u of this.units) if (u.tribe.id === 0 && u.state === 'perform' && u.target === tr) u.state = 'idle';
      this.checkWin();
    }
    this.refreshList();
  }

  conquer(tr) {
    tr.state = 'conquered';
    tr.hut.owner = 0;
    tr.hut.hp = tr.hut.maxHp * 0.5;
    this.food += 80;
    for (const u of this.units) if (u.tribe === tr) u.dead = true;
    sfx.win();
    ui.toast(`⚔ <b>${tr.name}</b> を征服した！ 食料 +80、人口上限アップ`, 'good');
    for (const u of this.units) if (u.target === tr.hut) { u.state = 'idle'; u.target = null; }
    this.refreshList();
    this.checkWin();
  }

  checkWin() {
    if (this.tribes.slice(1).every((t) => t.state !== 'neutral')) {
      this.nextBtn.classList.remove('hidden');
      ui.toast('<b>島がひとつになった！</b>「文明をひらく」で次の段階へ', 'good');
    }
  }

  finish() {
    const s = game.save;
    const allied = this.tribes.filter((t) => t.state === 'allied').length;
    const conq = this.tribes.filter((t) => t.state === 'conquered').length;
    s.traits.tribe = classify(allied, conq);
    game.persist();
    game.startStage('civ');
  }

  // ------------------------------------------------------------------ commands
  command(units, kind, target) {
    if (!units.length) { ui.toast('先に部族員を選択してください（ドラッグ or Aキー）', 'bad'); return; }
    let i = 0;
    for (const u of units) {
      u.state = kind; u.target = target;
      u.slot = i++;
      if (kind === 'move') u.goal = { x: target.x + ((i % 4) - 1.5) * 22, y: target.y + (Math.floor(i / 4) - 1) * 22 };
    }
    sfx.click();
    if (kind === 'attack' && target.owner != null && target.owner !== 0) {
      const tr = this.tribes[target.owner];
      if (tr.state === 'neutral') { tr.relation = Math.min(tr.relation, 10); this.refreshList(); }
    }
  }

  // Figure out what's under a world point.
  pick(w) {
    for (const tr of this.tribes) if (Math.hypot(tr.hut.x - w.x, tr.hut.y - w.y) < tr.hut.r) return { hut: tr.hut, tribe: tr };
    for (const u of this.units) if (!u.dead && Math.hypot(u.x - w.x, u.y - w.y) < u.r + 8) return { unit: u };
    for (const a of this.animals) if (!a.dead && Math.hypot(a.x - w.x, a.y - w.y) < a.r + 8) return { animal: a };
    for (const c of this.carcasses) if (Math.hypot(c.x - w.x, c.y - w.y) < 20) return { carcass: c };
    for (const b of this.bushes) if (Math.hypot(b.x - w.x, b.y - w.y) < b.r + 8) return { bush: b };
    return null;
  }

  contextCommand(w) {
    const units = [...this.sel];
    const h = this.pick(w);
    if (!h) return this.command(units, 'move', w);
    if (h.bush) return this.command(units, 'gather', h.bush);
    if (h.carcass) return this.command(units, 'gather', h.carcass);
    if (h.animal) return this.command(units, 'hunt', h.animal);
    if (h.unit) {
      if (h.unit.tribe.id !== 0 && h.unit.tribe.state !== 'allied') return this.command(units, 'attack', h.unit);
      return this.command(units, 'move', w);
    }
    if (h.hut) {
      if (h.tribe.id === 0 || h.tribe.state !== 'neutral') return this.command(units, 'move', w);
      return this.command(units, 'attack', h.hut);
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const inp = game.input;
    this.t += dt;
    game.save.stats.time += dt;
    const cam = this.cam;
    cam.w = game.w; cam.h = game.h;

    if (inp.wasPressed('KeyA')) this.sel = new Set(this.myUnits);
    if (inp.wasPressed('KeyG')) this.autoGather();
    if (inp.wasPressed('Escape')) this.sel.clear();

    // camera pan: WASD-less (A is select all) so arrows + edge drag
    const pan = 500 / cam.zoom * dt;
    if (inp.isDown('ArrowLeft')) cam.x -= pan;
    if (inp.isDown('ArrowRight')) cam.x += pan;
    if (inp.isDown('ArrowUp')) cam.y -= pan;
    if (inp.isDown('ArrowDown')) cam.y += pan;
    if (inp.wheel) cam.zoom = clamp(cam.zoom * (inp.wheel > 0 ? 0.9 : 1.1), 0.35, 2);
    // touch / right-drag panning
    if (inp.drag && inp.drag.touch) {
      if (this.lastDrag) { cam.x -= (inp.drag.x - this.lastDrag.x) / cam.zoom; cam.y -= (inp.drag.y - this.lastDrag.y) / cam.zoom; }
      this.lastDrag = { x: inp.drag.x, y: inp.drag.y };
    } else this.lastDrag = null;
    cam.x = clamp(cam.x, 0, SIZE); cam.y = clamp(cam.y, 0, SIZE);

    this.selector.update(cam, this.myUnits, this.sel);
    for (const c of inp.clicks) {
      const w = cam.toWorld(c.x, c.y);
      const h = this.pick(w);
      if (c.button === 2) { if (this.sel.size) this.contextCommand(w); continue; }
      if (h?.unit && h.unit.tribe.id === 0) {
        if (!c.shift) this.sel.clear();
        this.sel.add(h.unit);
      } else if (h?.hut && h.tribe.id !== 0) {
        this.openTribePanel(h.tribe);
      } else if (h?.hut && h.tribe.id === 0 && !this.sel.size) {
        this.sel = new Set(this.myUnits);
      } else if (this.sel.size) {
        this.contextCommand(w);
      }
    }

    for (const u of this.units) this.updateUnit(u, dt);
    this.units = this.units.filter((u) => !u.dead);
    for (const u of [...this.sel]) if (u.dead) this.sel.delete(u);
    separate(this.units, dt, (x, y) => this.terrain.isLand(x, y));

    for (const a of this.animals) this.updateAnimal(a, dt);
    this.animals = this.animals.filter((a) => !a.dead);
    if (this.animals.length < 20 && rng() < dt * 0.1) {
      const p = this.terrain.randomLand(rng, 0.35, 0.6);
      const pool = (game.save.species || []).filter((x) => x.design);
      if (pool.length) this.animals.push(this.makeAnimal(rng.pick(pool).design, p.x, p.y));
    }
    for (const b of this.bushes) b.food = Math.min(b.max, b.food + dt * 0.4);
    this.carcasses = this.carcasses.filter((c) => c.food > 0);

    // AI tribes
    const me = this.tribes[0];
    for (const tr of this.tribes.slice(1)) {
      if (tr.state !== 'neutral') continue;
      tr.food += dt * 0.5;
      const members = this.units.filter((u) => u.tribe === tr);
      if (members.length < 6 && tr.food > 25) { tr.food -= 25; this.spawnUnit(tr); }
      if (tr.relation < 25 || tr.aggressive && tr.relation < 40) {
        tr.raidT -= dt;
        if (tr.raidT <= 0) {
          tr.raidT = rng.range(80, 130);
          const raiders = members.filter((u) => u.state === 'idle').slice(0, 2 + Math.floor(this.t / 240));
          if (raiders.length) {
            for (const u of raiders) { u.state = 'attack'; u.target = me.hut; u.raidLeft = 45; }
            ui.toast(`⚠ <b>${tr.name}</b> が村を襲ってきた！`, 'bad');
            sfx.bad();
          }
        }
      }
    }
    // allies send food now and then
    for (const tr of this.tribes) {
      if (tr.state === 'allied' || tr.state === 'conquered') {
        tr.gT = (tr.gT || 0) + dt;
        if (tr.gT > 20) { tr.gT = 0; this.food += 10; this.fl.add(me.hut.x, me.hut.y - 60, '+10🍖', '#ffd36b'); }
      }
    }
    // our hut
    if (me.hut.hp <= 0) {
      me.hut.hp = me.hut.maxHp * 0.5;
      this.food = Math.floor(this.food / 2);
      ui.toast('村が荒らされ、食料の半分を奪われた！', 'bad');
      sfx.die();
    }

    this.fl.update(dt);
    this.px.update(dt);

    // HUD
    const pop = this.myUnits.length;
    this.resEl.innerHTML = `🍖 食料 <b>${fmt(this.food)}</b>　👥 ${pop} / ${this.popCap}`;
    this.hutBar(me.hut.hp / me.hut.maxHp, 'Lv' + me.level);
    this.unitBtn.classList.toggle('dim', this.food < COST_UNIT || pop >= this.popCap);
    this.hutBtn.classList.toggle('dim', this.food < COST_HUT * me.level || me.level >= 3);
    this.selInfo.textContent = this.sel.size ? `${this.sel.size}人選択中 — 右クリック/タップで命令` : '部族員をドラッグで選択';
    if ((this.listT = (this.listT || 0) - dt) <= 0) { this.listT = 1; this.refreshList(); }
  }

  updateUnit(u, dt) {
    u.cd -= dt; u.hurt = Math.max(0, u.hurt - dt * 3); u.act = Math.max(0, u.act - dt * 2);
    const mine = u.tribe.id === 0;
    const myHut = u.tribe.hut;
    let gx = null, gy = null, stop = 6;

    // auto-defend: idle units fight enemies that come close
    if (u.state === 'idle' || u.state === 'gather' || u.state === 'perform') {
      const enemy = this.units.find((o) => o.tribe !== u.tribe && o.state === 'attack' && (o.target === u || o.target === myHut || o.target?.tribe === u.tribe) && Math.hypot(o.x - u.x, o.y - u.y) < 160);
      if (enemy) { u.prev = { state: u.state, target: u.target }; u.state = 'attack'; u.target = enemy; }
    }

    switch (u.state) {
      case 'idle': {
        if (!mine) {
          u.wT = (u.wT || 0) - dt;
          if (u.wT <= 0) { u.wT = rng.range(3, 7); const a = rng() * TAU; u.goal = { x: myHut.x + Math.cos(a) * rng.range(70, 160), y: myHut.y + Math.sin(a) * rng.range(70, 160) }; }
        }
        if (u.goal) { gx = u.goal.x; gy = u.goal.y; }
        break;
      }
      case 'move':
        gx = u.goal.x; gy = u.goal.y;
        if (Math.hypot(gx - u.x, gy - u.y) < 8) { u.state = 'idle'; }
        break;
      case 'gather': {
        const b = u.target;
        if (u.carry > 0) {
          gx = myHut.x; gy = myHut.y; stop = myHut.r;
          if (Math.hypot(gx - u.x, gy - u.y) < myHut.r + 5) {
            this.food += u.carry;
            this.fl.add(u.x, u.y - 20, '+' + u.carry + '🍖', '#ffd36b', 13);
            u.carry = 0;
            if (!b || b.food < 5) { const nb = b?.carcass ? null : this.nearestBush(u.x, u.y); if (nb) u.target = nb; else u.state = 'idle'; }
          }
        } else if (!b || b.food <= 0) {
          const nb = this.nearestBush(u.x, u.y);
          if (nb && Math.hypot(nb.x - u.x, nb.y - u.y) < 600) u.target = nb; else u.state = 'idle';
        } else {
          gx = b.x; gy = b.y; stop = (b.r || 12) + u.r;
          if (Math.hypot(gx - u.x, gy - u.y) < stop + 4) {
            gx = null;
            u.gT = (u.gT || 0) + dt;
            u.act = 0.5;
            if (u.gT > 1.6) {
              u.gT = 0;
              const diet = computeStats(this.design);
              const mul = b.carcass ? (diet.carn > 0 ? 1.5 : 1) : (diet.herb > 0 ? 1.5 : 1);
              const take = Math.min(b.food, 10);
              b.food -= take;
              u.carry = Math.round(take * mul);
            }
          }
        }
        break;
      }
      case 'hunt': {
        const a = u.target;
        if (!a || a.dead) {
          const c = this.carcasses.find((c) => Math.hypot(c.x - u.x, c.y - u.y) < 150 && c.food > 0);
          if (c) { u.state = 'gather'; u.target = c; } else u.state = 'idle';
          break;
        }
        gx = a.x; gy = a.y; stop = a.r + u.r;
        if (Math.hypot(a.x - u.x, a.y - u.y) < stop + 6) {
          gx = null;
          u.rot = Math.atan2(a.y - u.y, a.x - u.x);
          if (u.cd <= 0) {
            u.cd = 1; u.act = 1;
            a.hp -= 8 * this.atkMul; a.hurt = 1; a.flee = u; sfx.hit();
            if (a.hp <= 0) {
              a.dead = true;
              this.carcasses.push({ x: a.x, y: a.y, food: 40, carcass: true, r: 12 });
              this.px.burst(a.x, a.y, '#c9493f', 12, 70);
            }
          }
        }
        break;
      }
      case 'attack': {
        const t = u.target;
        const isHut = t && t.maxHp && t.r > 40;
        if (!t || t.dead || (isHut && t.owner === u.tribe.id) || (isHut && this.tribes[t.owner]?.state !== 'neutral' && t.owner !== 0)) {
          if (u.prev) { u.state = u.prev.state; u.target = u.prev.target; u.prev = null; } else u.state = 'idle';
          break;
        }
        if (!mine && (t.tribe?.state === 'allied' || u.tribe.state !== 'neutral')) { u.state = 'idle'; break; }
        if (u.raidLeft != null && (u.raidLeft -= dt) <= 0) { u.raidLeft = null; u.state = 'idle'; u.goal = null; break; }
        gx = t.x; gy = t.y; stop = (t.r || 10) + u.r;
        if (Math.hypot(t.x - u.x, t.y - u.y) < stop + 8) {
          gx = null;
          u.rot = Math.atan2(t.y - u.y, t.x - u.x);
          if (u.cd <= 0) {
            u.cd = 1; u.act = 1;
            const dmg = (mine ? 8 * this.atkMul : 6) * (isHut ? 1.2 : 1);
            t.hp -= dmg; t.hurt = 1;
            sfx.hit();
            this.fl.add(t.x, t.y - (t.r || 10) - 6, '-' + Math.round(dmg), mine ? '#ffd36b' : '#ff8080', 12);
            if (!isHut && t.state !== 'attack') { t.prev = { state: t.state, target: t.target }; t.state = 'attack'; t.target = u; }
            if (t.hp <= 0) {
              if (isHut) {
                const tr = this.tribes[t.owner];
                if (tr.id !== 0) this.conquer(tr);
              } else {
                t.dead = true;
                this.px.burst(t.x, t.y, hsl(t.tribe.design.hue, 60, 55), 12, 70);
                if (t.tribe.id === 0) ui.toast('部族員がやられた…', 'bad');
              }
            }
          }
        }
        break;
      }
      case 'perform': {
        const tr = u.target;
        if (tr.state !== 'neutral') { u.state = 'idle'; break; }
        const a = (u.slot || 0) * 0.8;
        gx = tr.hut.x + Math.cos(a) * (tr.hut.r + 40); gy = tr.hut.y + Math.sin(a) * (tr.hut.r + 40);
        if (Math.hypot(gx - u.x, gy - u.y) < 20) {
          gx = null;
          u.act = 0.5 + 0.5 * Math.sin(this.t * 8 + u.slot);
          u.rot = Math.atan2(tr.hut.y - u.y, tr.hut.x - u.x);
          this.changeRelation(tr, dt * 0.6 * this.socialMul);
          if (rng() < dt * 1.5) { this.fl.add(u.x, u.y - 20, rng.pick(['🎵', '🎶', '🥁']), '#fff', 16); sfx.sing(); }
          // hostile tribes don't enjoy the concert
          if (tr.relation < 25 && rng() < dt * 0.4) {
            const g = this.units.find((o) => o.tribe === tr && o.state === 'idle');
            if (g) { g.state = 'attack'; g.target = u; }
          }
        }
        break;
      }
    }

    if (gx != null) {
      const d = Math.hypot(gx - u.x, gy - u.y);
      if (d > stop) {
        const a = Math.atan2(gy - u.y, gx - u.x);
        u.rot = turnTowards(u.rot, a, 8 * dt);
        const sp = u.speed * dt;
        const nx = u.x + Math.cos(a) * sp, ny = u.y + Math.sin(a) * sp;
        if (this.terrain.isLand(nx, ny)) { u.x = nx; u.y = ny; }
        else if (this.terrain.isLand(nx, u.y)) u.x = nx;
        else if (this.terrain.isLand(u.x, ny)) u.y = ny;
        u.phase += dt * u.speed / 7;
        u.move = Math.min(1, u.move + dt * 4);
      } else u.move = Math.max(0, u.move - dt * 4);
    } else u.move = Math.max(0, u.move - dt * 4);
  }

  updateAnimal(a, dt) {
    a.hurt = Math.max(0, a.hurt - dt * 3);
    let gx, gy, sp = 30;
    if (a.flee && !a.flee.dead && Math.hypot(a.flee.x - a.x, a.flee.y - a.y) < 200) {
      const ang = Math.atan2(a.y - a.flee.y, a.x - a.flee.x);
      gx = a.x + Math.cos(ang) * 50; gy = a.y + Math.sin(ang) * 50; sp = 55;
    } else {
      a.wanderT -= dt;
      if (a.wanderT <= 0) { a.wanderT = rng.range(3, 8); a.goal = rng() < 0.5 ? null : { x: a.x + rng.range(-150, 150), y: a.y + rng.range(-150, 150) }; }
      if (a.goal) { gx = a.goal.x; gy = a.goal.y; }
    }
    if (gx != null && Math.hypot(gx - a.x, gy - a.y) > 5) {
      const ang = Math.atan2(gy - a.y, gx - a.x);
      a.rot = turnTowards(a.rot, ang, 4 * dt);
      const nx = a.x + Math.cos(a.rot) * sp * dt, ny = a.y + Math.sin(a.rot) * sp * dt;
      if (this.terrain.isLand(nx, ny)) { a.x = nx; a.y = ny; } else a.goal = null;
      a.phase += dt * sp / 8;
      a.move = 1;
    } else a.move = 0;
  }

  // ------------------------------------------------------------------ draw
  draw(ctx) {
    const cam = this.cam;
    ctx.fillStyle = '#0e325c';
    ctx.fillRect(0, 0, game.w, game.h);
    ctx.save();
    cam.apply(ctx);
    this.terrain.draw(ctx);

    for (const b of this.bushes) {
      if (!cam.visible(b.x, b.y, 30)) continue;
      ctx.fillStyle = '#2f6b2a'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3f8a36'; ctx.beginPath(); ctx.arc(b.x - 4, b.y - 4, b.r * 0.7, 0, TAU); ctx.fill();
      const n = Math.ceil(b.food / 8);
      ctx.fillStyle = '#e8434a';
      for (let i = 0; i < n; i++) { const a = i * 1.3; ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * b.r * 0.6, b.y + Math.sin(a) * b.r * 0.6, 3.2, 0, TAU); ctx.fill(); }
    }
    for (const c of this.carcasses) {
      ctx.fillStyle = '#c9493f'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 12, 8, 0.3, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f3ecd6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c.x - 8, c.y); ctx.lineTo(c.x + 8, c.y - 3); ctx.stroke();
    }

    for (const tr of this.tribes) this.drawHut(ctx, tr);

    for (const a of this.animals) {
      if (!cam.visible(a.x, a.y, 40)) continue;
      drawCreature(ctx, a.design, a.x, a.y, a.rot, a.scale, { phase: a.phase, move: a.move, hurt: a.hurt });
      if (a.hp < a.maxHp) drawBar(ctx, a.x, a.y - a.r - 10, 28, a.hp / a.maxHp);
    }

    for (const u of this.units) {
      if (!cam.visible(u.x, u.y, 40)) continue;
      if (this.sel.has(u)) {
        ctx.strokeStyle = '#8f8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(u.x, u.y, u.r + 7, (u.r + 7) * 0.75, 0, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = u.tribe.color; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.ellipse(u.x, u.y, u.r + 5, (u.r + 5) * 0.75, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      drawCreature(ctx, u.tribe.design, u.x, u.y, u.rot, UNIT_SCALE, { phase: u.phase, move: u.move, hurt: u.hurt, act: u.act });
      drawTool(ctx, u, this.t);
      if (u.carry) { ctx.fillStyle = '#e8434a'; ctx.beginPath(); ctx.arc(u.x, u.y - u.r - 4, 5, 0, TAU); ctx.fill(); }
      if (u.hp < u.maxHp) drawBar(ctx, u.x, u.y - u.r - 12, 26, u.hp / u.maxHp);
    }

    this.px.draw(ctx);
    this.fl.draw(ctx, cam.zoom);
    ctx.restore();
    this.selector.draw(ctx);
    this.drawMinimap();
  }

  drawHut(ctx, tr) {
    const h = tr.hut;
    const conquered = tr.state === 'conquered';
    const col = conquered ? this.tribes[0].color : tr.color;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.fillStyle = 'rgba(120,90,50,0.45)';
    ctx.beginPath(); ctx.arc(0, 0, h.r + 35, 0, TAU); ctx.fill();
    // fence
    ctx.strokeStyle = '#6b4a24'; ctx.lineWidth = 4;
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (h.r + 30), Math.sin(a) * (h.r + 30)); ctx.lineTo(Math.cos(a) * (h.r + 38), Math.sin(a) * (h.r + 38)); ctx.stroke(); }
    // huts
    const huts = tr.me ? 1 + tr.level : 3;
    for (let i = 0; i < huts; i++) {
      const a = i / huts * TAU + 0.5;
      const x = Math.cos(a) * h.r * 0.55, y = Math.sin(a) * h.r * 0.55;
      ctx.fillStyle = '#8a6a3a'; ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) { const b = k / 6 * TAU; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * 18, y + Math.sin(b) * 18); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill();
    }
    // fire + totem
    const f = 1 + Math.sin(this.t * 12 + h.fire) * 0.15;
    ctx.fillStyle = '#ff9a2a'; ctx.beginPath(); ctx.arc(0, 0, 9 * f, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.arc(0, 0, 5 * f, 0, TAU); ctx.fill();
    ctx.restore();
    drawCreature(ctx, tr.design, h.x, h.y - h.r - 10, -Math.PI / 2, 0.5, { shadow: false, alpha: conquered ? 0.4 : 1 });
    if (h.hp < h.maxHp) drawBar(ctx, h.x, h.y + h.r + 42, 70, h.hp / h.maxHp);
    ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const label = tr.name + (tr.state === 'allied' ? ' 🤝' : tr.state === 'conquered' ? ' ⚔' : tr.me ? ' ★' : '');
    ctx.strokeText(label, h.x, h.y + h.r + 62); ctx.fillStyle = '#fff'; ctx.fillText(label, h.x, h.y + h.r + 62);
    if (!tr.me && tr.state === 'neutral') drawBar(ctx, h.x, h.y + h.r + 68, 70, tr.relation / 100, tr.relation < 25 ? '#f55' : '#f8c');
  }

  drawMinimap() {
    const c = this.mini.getContext('2d');
    const S = 150, k = S / SIZE;
    c.clearRect(0, 0, S, S);
    this.terrain.drawMini(c, 0, 0, S);
    for (const tr of this.tribes) {
      c.fillStyle = tr.state === 'conquered' ? this.tribes[0].color : tr.color;
      c.beginPath(); c.arc(tr.hut.x * k, tr.hut.y * k, tr.me ? 6 : 5, 0, TAU); c.fill();
      c.strokeStyle = tr.me ? '#fff' : '#000'; c.lineWidth = 1.5; c.stroke();
    }
    for (const u of this.units) { c.fillStyle = u.tribe.id === 0 ? '#ff0' : u.tribe.color; c.fillRect(u.x * k - 1, u.y * k - 1, 2, 2); }
    const cam = this.cam;
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.strokeRect((cam.x - game.w / 2 / cam.zoom) * k, (cam.y - game.h / 2 / cam.zoom) * k, game.w / cam.zoom * k, game.h / cam.zoom * k);
    if (!this.miniBound) {
      this.miniBound = true;
      this.mini.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const r = this.mini.getBoundingClientRect();
        this.cam.x = (e.clientX - r.left) / r.width * SIZE;
        this.cam.y = (e.clientY - r.top) / r.height * SIZE;
      });
    }
  }
}

function drawTool(ctx, u, t) {
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.rotate(u.rot + 1.2 - u.act * 1.2);
  ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(4 + u.r * 1.5, 4); ctx.stroke();
  ctx.fillStyle = u.tool === 'spear' ? '#ccc' : '#8d8d8d';
  if (u.tool === 'spear') { ctx.beginPath(); ctx.moveTo(4 + u.r * 1.5, 0.5); ctx.lineTo(10 + u.r * 1.5, 4); ctx.lineTo(4 + u.r * 1.5, 7.5); ctx.fill(); }
  else if (u.tool === 'axe') { ctx.beginPath(); ctx.ellipse(2 + u.r * 1.5, 1, 3, 5, 0, 0, TAU); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(4 + u.r * 1.5, 4, 3.5, 0, TAU); ctx.fill(); }
  ctx.restore();
}
