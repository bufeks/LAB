// Creature stage: roam an island, befriend or hunt other species, find
// new parts in bone piles, and grow a bigger brain.

import { game } from './game.js';
import { ui, Floaters, Particles } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, lerp, rng, mulberry32, angleDiff, turnTowards, Camera, hsl, fmt } from './util.js';
import { PARTS, computeStats, drawCreature, randomDesign, designRadius, STAT_LABELS } from './creature.js';
import { Terrain } from './terrain.js';
import { classify } from './save.js';

const SIZE = 3600;
const BRAIN_XP = [0, 100, 230, 380, 560];
const SOCIAL = ['sing', 'dance', 'charm', 'pose'];
const COMBAT = ['bite', 'strike', 'charge', 'spit'];
const ICON = { sing: '🎵', dance: '💃', charm: '💖', pose: '✨', bite: '🦷', strike: '🐾', charge: '💥', spit: '🟢' };
const KEYS = { bite: 'Digit1', strike: 'Digit2', charge: 'Digit3', spit: 'Digit4', sing: 'Digit5', dance: 'Digit6', charm: 'Digit7', pose: 'Digit8' };
const CREATURE_PARTS = Object.keys(PARTS).filter((t) => PARTS[t].stage === 'creature');

export class CreatureScene {
  constructor() {
    const s = game.save;
    if (!s.world) s.world = { seed: rng.int(1, 1e9) };
    if (s.brainXp == null) s.brainXp = 0;
    this.seed = s.world.seed;
    this.terrain = new Terrain(SIZE, this.seed);
    this.cam = new Camera();
    this.cam.zoom = 1.2;
    this.fl = new Floaters();
    this.px = new Particles();
    this.t = 0;
    this.projectiles = [];
    this.meat = [];
    this.fruit = [];
    this.enc = null;
    this.selected = null;
    this.buildWorld();
  }

  // --- world generation (deterministic from the seed, fates from the save)
  buildWorld() {
    const r = mulberry32(this.seed);
    const T = this.terrain;
    const s = game.save;
    this.nest = T.randomLand(r, 0.38, 0.55);
    // our nest should be roughly central-ish
    for (let i = 0; i < 40; i++) {
      const p = T.randomLand(r, 0.38, 0.55);
      if (Math.hypot(p.x - SIZE / 2, p.y - SIZE / 2) < Math.hypot(this.nest.x - SIZE / 2, this.nest.y - SIZE / 2)) this.nest = p;
    }
    this.trees = [];
    for (let i = 0; i < 260; i++) {
      const p = T.randomLand(r, 0.34, 0.62);
      const forest = T.isForest(p.x, p.y);
      if (!forest && r() < 0.6) continue;
      this.trees.push({ x: p.x, y: p.y, r: r.range(18, 34), fruitT: r.range(0, 20), hue: r.int(90, 140), fruitHue: r.pick([0, 20, 45, 280, 320]) });
    }
    this.rocks = [];
    for (let i = 0; i < 70; i++) { const p = T.randomLand(r, 0.34, 0.7); this.rocks.push({ ...p, r: r.range(6, 16), a: r() * TAU }); }
    this.bones = [];
    for (let i = 0; i < 12; i++) { const p = T.randomLand(r, 0.33, 0.64); this.bones.push({ ...p, taken: (s.bonesTaken || []).includes(i), id: i }); }

    // species
    if (!s.species || !s.species.length || s.species[0].stage !== 'creature') {
      s.species = [];
      const diets = ['herb', 'herb', 'carn', 'omni', 'herb', 'carn', 'herb'];
      for (let i = 0; i < 7; i++) {
        const diet = diets[i];
        const seed = r.int(1, 1e9);
        s.species.push({ stage: 'creature', seed, diet, fate: null, power: 0.5 + i * 0.35 });
      }
    }
    const nests = [];
    this.species = s.species.map((sp, i) => {
      // stronger species live farther away; keep the best-scoring candidate
      let p = null, best = -1e9;
      const want = 500 + i * 160;
      for (let k = 0; k < 300; k++) {
        const q = T.randomLand(r, 0.36, 0.6);
        const fromUs = Math.hypot(q.x - this.nest.x, q.y - this.nest.y);
        const gap = Math.min(900, ...nests.map((n) => Math.hypot(n.x - q.x, n.y - q.y)));
        const score = Math.min(gap, 420) * 2 + Math.min(fromUs, want) * 1.5 - Math.abs(fromUs - want) * 0.3;
        if (score > best) { best = score; p = q; }
      }
      nests.push(p);
      const design = randomDesign(sp.seed, 'creature', sp.diet, sp.power);
      const st = computeStats(design);
      const rr = mulberry32(sp.seed);
      const temper = sp.diet === 'carn' ? (rr() < 0.75 ? 'aggressive' : 'neutral') : sp.diet === 'omni' ? rr.pick(['neutral', 'aggressive', 'shy']) : rr.pick(['shy', 'neutral', 'neutral']);
      // they ask for the social moves they themselves are good at
      let wants = SOCIAL.filter((k) => st[k] > 0);
      while (wants.length < 2) { const k = rr.pick(SOCIAL); if (!wants.includes(k)) wants.push(k); }
      const level = clamp(Math.round(1 + sp.power), 1, 5);
      return {
        idx: i, save: sp, design, stats: st, nest: p, temper, wants, level,
        name: design.name, hostile: false, members: [], friendship: sp.friendship || 0,
      };
    });
    for (const sp of this.species) {
      sp.save.design = sp.design;
      if (sp.save.fate === 'extinct') continue;
      const n = 3 + (sp.idx % 3);
      for (let k = 0; k < n; k++) this.spawnMember(sp, k === 0 && sp.power > 1.8);
    }
    // our own species waits at the nest
    this.mates = [0, 1].map((k) => ({ x: this.nest.x + (k ? 40 : -40), y: this.nest.y + 30, rot: -Math.PI / 2, phase: k }));
    // an epic roams the far side
    this.epic = null;
    let ep = T.randomLand(r, 0.38, 0.6);
    for (let k = 0; k < 60; k++) {
      const q = T.randomLand(r, 0.38, 0.6);
      if (Math.hypot(q.x - this.nest.x, q.y - this.nest.y) > Math.hypot(ep.x - this.nest.x, ep.y - this.nest.y)) ep = q;
    }
    const ed = randomDesign(r.int(1, 1e9), 'creature', 'carn', 3);
    const es = computeStats(ed);
    if (!s.epicDead) this.epic = this.makeCreature(null, ed, es, ep.x, ep.y, 3.2, { hp: 900, dmg: 26, epic: true });
    this.allies = [];
  }

  makeCreature(sp, design, stats, x, y, scale, extra = {}) {
    const hp = extra.hp || (40 + stats.mass / 12 + stats.armor * 20) * (sp ? 0.6 + sp.level * 0.35 : 1);
    return {
      sp, design, stats, x, y, rot: rng() * TAU, vx: 0, vy: 0, phase: rng() * 10, move: 0, scale,
      r: designRadius(design) * scale, hp, maxHp: hp, cd: rng() * 2, hurt: 0, act: 0,
      state: 'home', target: null, wander: rng() * TAU, wanderT: 0,
      speed: 45 + stats.speed * 20, dmg: extra.dmg || (3 + (stats.bite + stats.strike + stats.charge) * 2.2) * (sp ? 0.6 + sp.level * 0.25 : 1),
      epic: !!extra.epic, home: { x, y },
    };
  }

  spawnMember(sp, big) {
    const a = rng() * TAU;
    let x = sp.nest.x + Math.cos(a) * 60, y = sp.nest.y + Math.sin(a) * 60;
    if (!this.terrain.isLand(x, y)) { x = sp.nest.x; y = sp.nest.y; }
    const c = this.makeCreature(sp, sp.design, sp.stats, x, y, big ? 1.35 : rng.range(0.85, 1.1));
    c.home = sp.nest;
    sp.members.push(c);
    return c;
  }

  get creatures() {
    const out = [];
    for (const sp of this.species) for (const c of sp.members) out.push(c);
    if (this.epic) out.push(this.epic);
    return out;
  }

  // --- player
  enter() {
    const s = game.save;
    this.design = s.creatureDesign;
    this.applyDesign();
    this.player = { x: this.nest.x, y: this.nest.y + 60, rot: -Math.PI / 2, vx: 0, vy: 0, phase: 0, move: 0,
      hp: this.maxHp, hurt: 0, act: 0, food: 100, dead: 0, cds: {}, dash: 0, goal: null };
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.buildHud();
    if (!s.creatureIntroShown) {
      s.creatureIntroShown = true;
      ui.modal('クリーチャー期', `
        <p>陸にあがった！この島には他の生き物たちが暮らしています。</p>
        <ul>
          <li><b>移動</b>: WASD / クリックした場所へ歩く</li>
          <li><b>相手を選ぶ</b>: 生き物をクリック</li>
          <li><b>交流</b> 🎵💃💖✨ (5〜8キー): 相手が吹き出しで求める動きをまねると仲良くなれる</li>
          <li><b>戦闘</b> 🦷🐾💥🟢 (1〜4キー): 群れを全滅させると絶滅</li>
          <li>島のあちこちの <b>骨</b> から新しいパーツが見つかる。<b>巣</b>に戻るとエディタで進化できる</li>
          <li>仲良くなるか絶滅させて <b>脳</b> を育てよう。脳がLv5になると部族期へ！</li>
        </ul>`, [{ label: 'はじめる', cls: 'primary' }]);
    }
  }

  applyDesign() {
    const st = (this.stats = computeStats(this.design));
    const trait = game.save.traits.cell;
    this.radius = designRadius(this.design);
    const hpMul = trait === 'herb' ? 1.3 : trait === 'omni' ? 1.15 : 1;
    this.atkMul = trait === 'carn' ? 1.3 : trait === 'omni' ? 1.15 : 1;
    this.maxHp = (70 + st.mass / 10 + st.armor * 25 + this.brain * 15) * hpMul;
    this.speed = 55 + st.speed * 26;
  }

  get brain() {
    const xp = game.save.brainXp;
    let l = 1;
    while (l < 5 && xp >= BRAIN_XP[l]) l++;
    return l;
  }

  addXp(n, why) {
    const before = this.brain;
    game.save.brainXp += n;
    if (this.brain > before) {
      sfx.level();
      this.applyDesign();
      this.player.hp = this.maxHp;
      if (this.brain >= 5) {
        ui.toast('<b>脳が十分に発達した！</b>「部族をつくる」で次の段階へ', 'good');
      } else ui.toast(`🧠 <b>脳が Lv${this.brain} に成長！</b> 仲間を${this.brain}匹まで連れて歩ける`, 'good');
    }
  }

  buildHud() {
    const top = ui.el('div', 'hud top-left');
    ui.el('div', 'stage-name', top, 'クリーチャー期');
    this.hpBar = ui.meter(top, '体力', 'hp');
    this.foodBar = ui.meter(top, '空腹', 'food');
    this.brainBar = ui.meter(top, '脳', 'brain');
    this.dnaEl = ui.el('div', 'dna', top);

    const right = ui.el('div', 'hud top-right');
    this.editBtn = ui.button('🧬 巣でエディタを開く', '', () => this.openEditor(), right);
    this.recruitBtn = ui.button('🤝 仲間にする', 'hidden', () => this.recruit(), right);
    this.nextBtn = ui.button('🔥 部族をつくる！', 'primary hidden', () => this.finish(), right);
    ui.button('⏸', 'small', () => { this.saveState(); game.go('title'); }, right).title = 'タイトルへ';
    this.spList = ui.el('div', 'panel species-list', right);

    const bottom = ui.el('div', 'hud bottom-center');
    const bar = ui.el('div', 'abilities', bottom);
    this.abBtns = {};
    for (const k of [...COMBAT, ...SOCIAL]) {
      const b = ui.button(`<span class="ico">${ICON[k]}</span><span class="lbl">${STAT_LABELS[k]}</span><span class="key">${KEYS[k].slice(-1)}</span><i class="cd"></i>`, 'ability ' + (SOCIAL.includes(k) ? 'social' : 'combat'), () => this.useAbility(k), bar);
      this.abBtns[k] = b;
    }
    this.encBox = ui.el('div', 'encounter hidden', ui.root);
    this.mini = ui.el('canvas', 'minimap', ui.root);
    this.mini.width = this.mini.height = 150;
    this.refreshHud();
  }

  refreshHud() {
    for (const k in this.abBtns) {
      const lv = this.stats[k];
      this.abBtns[k].classList.toggle('disabled', !(lv > 0));
      this.abBtns[k].querySelector('.lbl').textContent = STAT_LABELS[k] + (lv > 0 ? ' ' + lv.toFixed(1) : '');
    }
    let h = '<h3>島の生き物</h3>';
    for (const sp of this.species) {
      const f = sp.save.fate;
      const st = f === 'friend' ? '<span class="ok">友だち</span>' : f === 'extinct' ? '<span class="bad">絶滅</span>' : sp.hostile ? '<span class="bad">敵対</span>' : sp.seen ? `${sp.temper === 'aggressive' ? '⚠️' : ''}${sp.wants.map((w) => ICON[w]).join('')}` : '？？？';
      h += `<div class="sp"><i style="background:${hsl(sp.design.hue, sp.design.sat, 55)}"></i>${sp.seen || f ? sp.name : '？？？'}<span>${st}</span></div>`;
    }
    this.spList.innerHTML = h;
  }

  openEditor() {
    const p = this.player;
    if (Math.hypot(p.x - this.nest.x, p.y - this.nest.y) > 220) { ui.toast('巣に戻らないと進化できません（ミニマップの🏠）', 'bad'); return; }
    this.saveState();
    const s = game.save;
    game.go('editor', {
      kind: 'creature', design: this.design, dna: s.dna, unlocked: s.unlocked, title: 'クリーチャーエディタ',
      onDone: (d, dna) => { s.creatureDesign = d; s.dna = dna; game.persist(); game.go('creature'); },
    });
  }

  saveState() {
    const s = game.save;
    for (const sp of this.species) sp.save.friendship = sp.friendship;
    game.persist();
  }

  finish() {
    const s = game.save;
    const friends = s.species.filter((x) => x.fate === 'friend').length;
    const ext = s.species.filter((x) => x.fate === 'extinct').length;
    s.traits.creature = classify(friends, ext);
    s.creatureStats = { friends, ext };
    this.saveState();
    game.startStage('tribe');
  }

  recruit() {
    const p = this.player;
    if (this.allies.length >= this.brain) { ui.toast(`今の脳では仲間は${this.brain}匹まで`, 'bad'); return; }
    let best = null, bd = 200;
    for (const c of this.creatures) {
      if (c.ally || c.epic || c.sp?.save.fate !== 'friend') continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    best.ally = true;
    best.state = 'follow';
    this.allies.push(best);
    sfx.good();
    ui.toast(`${best.sp.name} が仲間になった！`, 'good');
  }

  // --- abilities
  targetFor(range) {
    const p = this.player;
    if (this.selected && !this.selected.dead && Math.hypot(this.selected.x - p.x, this.selected.y - p.y) < range) return this.selected;
    let best = null, bd = range;
    for (const c of this.creatures) {
      if (c.dead || c.ally) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y) - c.r;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  useAbility(k) {
    const p = this.player;
    if (p.dead) return;
    const lv = this.stats[k];
    if (!(lv > 0)) { ui.toast(`${STAT_LABELS[k]}のパーツがありません。骨を探してエディタで付けよう`, 'bad'); sfx.bad(); return; }
    if ((p.cds[k] || 0) > 0) return;
    if (SOCIAL.includes(k)) return this.social(k, lv);

    const range = k === 'spit' ? 320 : k === 'charge' ? 220 : this.radius + 30;
    const tgt = this.targetFor(k === 'spit' ? 360 : 260);
    if (!tgt) { ui.toast('近くに相手がいません', 'bad'); return; }
    if (tgt.sp?.save.fate === 'friend') { ui.toast('友だちは攻撃しません', 'bad'); return; }
    const d = Math.hypot(tgt.x - p.x, tgt.y - p.y) - tgt.r;
    this.selected = tgt;
    if (d > range) { p.goal = { c: tgt, ability: k }; return; }
    p.goal = null;
    const mul = this.atkMul * (1 + (this.brain - 1) * 0.08);
    p.rot = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    p.act = 1;
    if (this.enc) this.endEncounter(false, true);
    if (k === 'bite') { p.cds.bite = 0.9; this.hit(tgt, (6 + lv * 6) * mul); }
    else if (k === 'strike') { p.cds.strike = 1.3; this.hit(tgt, (6 + lv * 8) * mul); }
    else if (k === 'charge') { p.cds.charge = 4; p.dash = 0.35; p.dashTarget = tgt; p.dashDmg = (10 + lv * 10) * mul; sfx.hit(); }
    else if (k === 'spit') {
      p.cds.spit = 2.2;
      const a = p.rot;
      this.projectiles.push({ x: p.x + Math.cos(a) * this.radius, y: p.y + Math.sin(a) * this.radius, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, dmg: (5 + lv * 6) * mul, life: 1, owner: 'player' });
      sfx.hit();
    }
    for (const a of this.allies) { a.state = 'fight'; a.target = tgt; }
  }

  hit(c, dmg, byPlayer = true) {
    c.hp -= dmg;
    c.hurt = 1;
    this.fl.add(c.x, c.y - c.r - 6, '-' + Math.round(dmg), byPlayer ? '#ffd36b' : '#ddd');
    this.px.burst(c.x, c.y, '#ff6b6b', 6, 60, 0.4);
    sfx.hit();
    if (c.sp && byPlayer && !c.sp.hostile && c.sp.save.fate !== 'friend') {
      c.sp.hostile = true;
      if (c.sp.temper !== 'shy') ui.toast(`${c.sp.name}の群れが怒った！`, 'bad');
      this.refreshHud();
    }
    if (byPlayer) { c.state = c.sp?.temper === 'shy' && !c.epic ? 'flee' : 'fight'; c.target = this.player; }
    if (c.hp <= 0) this.kill(c, byPlayer);
  }

  kill(c, byPlayer) {
    if (c.dead) return;
    c.dead = true;
    this.px.burst(c.x, c.y, hsl(c.design.hue, 60, 55), 20, 100, 0.8);
    for (let i = 0; i < 3; i++) this.meat.push({ x: c.x + rng.range(-15, 15), y: c.y + rng.range(-15, 15), t: 60 });
    const s = game.save;
    if (c.epic) {
      this.epic = null; s.epicDead = true;
      s.dna += 200; this.addXp(80);
      ui.toast('<b>巨大生物を倒した！</b> DNA +200', 'good');
      return;
    }
    if (c.ally) this.allies = this.allies.filter((a) => a !== c);
    const sp = c.sp;
    sp.members = sp.members.filter((m) => m !== c);
    if (byPlayer) { s.stats.kills++; s.dna += 12; this.addXp(12); this.fl.add(c.x, c.y, '+12🧬', '#9ef0ff'); }
    if (sp.members.length === 0 && sp.save.fate !== 'friend') {
      sp.save.fate = 'extinct';
      s.dna += 60;
      this.addXp(100);
      sfx.die();
      ui.toast(`☠ <b>${sp.name}</b> は絶滅した… DNA +60`, 'bad');
      this.refreshHud();
      game.persist();
    }
  }

  // --- social encounters (mirror what they ask for)
  social(k, lv) {
    const p = this.player;
    p.cds[k] = 1.1;
    p.act = 1;
    ({ sing: sfx.sing, dance: sfx.dance, charm: sfx.charm, pose: sfx.pose })[k]();
    this.px.burst(p.x, p.y - 10, { sing: '#9ef', dance: '#fd6', charm: '#f8c', pose: '#fff' }[k], 10, 70, 0.8, 3);
    this.fl.add(p.x, p.y - this.radius - 10, ICON[k], '#fff', 22);

    if (!this.enc) {
      const tgt = this.targetFor(240);
      if (!tgt || !tgt.sp || tgt.epic) { return; }
      const sp = tgt.sp;
      if (sp.save.fate === 'friend') { ui.toast(`${sp.name}とはもう友だち`, ''); return; }
      if (sp.hostile) { ui.toast(`${sp.name}は怒っていて話を聞かない`, 'bad'); return; }
      this.startEncounter(tgt);
    }
    const e = this.enc;
    if (!e) return;
    if (k === e.want) {
      const gain = (10 + lv * 12) * (lv >= e.sp.level ? 1.2 : 0.7);
      e.sp.friendship = Math.min(100, e.sp.friendship + gain);
      sfx.good();
      this.fl.add(e.c.x, e.c.y - e.c.r - 16, '👍', '#fff', 24);
      e.c.act = 1;
      if (e.sp.friendship >= 100) return this.endEncounter(true);
      this.nextWant();
    } else {
      e.sp.friendship = Math.max(0, e.sp.friendship - 8);
      e.strikes++;
      sfx.bad();
      this.fl.add(e.c.x, e.c.y - e.c.r - 16, '👎', '#fff', 24);
      if (e.strikes >= 3) return this.endEncounter(false);
    }
  }

  startEncounter(c) {
    const sp = c.sp;
    sp.seen = true;
    this.enc = { c, sp, want: null, t: 0, strikes: 0 };
    c.state = 'social';
    this.nextWant();
    this.encBox.classList.remove('hidden');
    this.refreshHud();
  }

  nextWant() {
    const e = this.enc;
    const opts = e.sp.wants.filter((w) => w !== e.want);
    e.want = opts.length ? rng.pick(opts) : e.sp.wants[0];
    e.t = 5;
  }

  endEncounter(success, silent) {
    const e = this.enc;
    if (!e) return;
    this.enc = null;
    this.encBox.classList.add('hidden');
    for (const m of e.sp.members) if (m.state === 'social') m.state = 'home';
    if (success) {
      e.sp.save.fate = 'friend';
      game.save.stats.friends++;
      game.save.dna += 60;
      this.addXp(100);
      sfx.win();
      ui.toast(`🤝 <b>${e.sp.name}</b> と友だちになった！ DNA +60　（近くで「仲間にする」）`, 'good');
      game.persist();
    } else if (!silent) {
      ui.toast(`${e.sp.name}はあきれて去っていった…`, 'bad');
      if (e.sp.temper === 'aggressive') { e.sp.hostile = true; e.c.state = 'fight'; e.c.target = this.player; }
    }
    this.refreshHud();
  }

  hurtPlayer(dmg, from) {
    const p = this.player;
    if (p.dead || p.inv > 0) return;
    dmg *= 1 - this.stats.armor * 0.08;
    p.hp -= dmg;
    p.hurt = 1;
    sfx.hurt();
    this.fl.add(p.x, p.y - this.radius, '-' + Math.round(dmg), '#ff6b6b');
    if (from) for (const a of this.allies) if (a.state !== 'fight') { a.state = 'fight'; a.target = from; }
    if (p.hp <= 0) {
      p.dead = 3;
      sfx.die();
      if (this.enc) this.endEncounter(false, true);
      ui.toast('やられてしまった…巣で目を覚まします', 'bad');
    }
  }

  // --- movement helper that respects the coastline
  moveBody(o, dx, dy) {
    const T = this.terrain;
    const nx = o.x + dx, ny = o.y + dy;
    if (T.isLand(nx, ny)) { o.x = nx; o.y = ny; return true; }
    if (T.isLand(nx, o.y)) { o.x = nx; return false; }
    if (T.isLand(o.x, ny)) { o.y = ny; return false; }
    return false;
  }

  update(dt) {
    const inp = game.input;
    const p = this.player;
    const s = game.save;
    this.t += dt;
    s.stats.time += dt;

    for (const k in KEYS) if (inp.wasPressed(KEYS[k])) this.useAbility(k);
    if (inp.wasPressed('KeyE')) this.openEditor();
    if (inp.wasPressed('KeyR')) this.recruit();
    if (inp.wasPressed('Escape')) { this.selected = null; p.goal = null; }

    // clicks: select creature or walk
    for (const c of inp.clicks) {
      const w = this.cam.toWorld(c.x, c.y);
      let hit = null, hd = 1e9;
      for (const cr of this.creatures) {
        const d = Math.hypot(cr.x - w.x, cr.y - w.y);
        if (d < cr.r + 12 && d < hd) { hd = d; hit = cr; }
      }
      if (hit) { this.selected = hit; if (hit.sp) hit.sp.seen = true; this.refreshHud(); p.goal = { c: hit }; }
      else { p.goal = { x: w.x, y: w.y }; }
    }

    // --- player
    for (const k in p.cds) p.cds[k] -= dt;
    p.hurt = Math.max(0, p.hurt - dt * 3);
    p.act = Math.max(0, p.act - dt * 2);
    p.inv = (p.inv || 0) - dt;
    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) {
        p.dead = 0; p.hp = this.maxHp; p.food = 70; p.inv = 2;
        p.x = this.nest.x; p.y = this.nest.y + 50;
        for (const sp of this.species) sp.hostile = false;
      }
    } else {
      let mx = 0, my = 0;
      const ax = inp.axis();
      if (ax.x || ax.y) { mx = ax.x; my = ax.y; p.goal = null; }
      else if (p.goal) {
        const gx = p.goal.c ? p.goal.c.x : p.goal.x, gy = p.goal.c ? p.goal.c.y : p.goal.y;
        const d = Math.hypot(gx - p.x, gy - p.y);
        const stop = p.goal.c ? p.goal.c.r + this.radius + (p.goal.ability === 'spit' ? 260 : p.goal.ability === 'charge' ? 180 : 10) : 6;
        if (p.goal.c?.dead) p.goal = null;
        else if (d > stop) { mx = (gx - p.x) / d; my = (gy - p.y) / d; }
        else { const ab = p.goal.ability; p.goal = null; if (ab) this.useAbility(ab); }
      }
      let sp = this.speed * (p.food <= 0 ? 0.6 : 1);
      if (p.dash > 0) {
        p.dash -= dt;
        const t = p.dashTarget;
        if (t && !t.dead) {
          const a = Math.atan2(t.y - p.y, t.x - p.x);
          mx = Math.cos(a); my = Math.sin(a); sp = 520;
          if (Math.hypot(t.x - p.x, t.y - p.y) < t.r + this.radius) { this.hit(t, p.dashDmg); p.dash = 0; p.dashTarget = null; }
        }
      }
      if (mx || my) {
        p.rot = turnTowards(p.rot, Math.atan2(my, mx), 8 * dt);
        this.moveBody(p, mx * sp * dt, my * sp * dt);
        p.phase += dt * sp / 9;
        p.move = Math.min(1, p.move + dt * 4);
      } else p.move = Math.max(0, p.move - dt * 4);

      // hunger
      p.food -= dt * 0.9;
      if (p.food <= 0) { p.food = 0; p.hp -= dt * 2; if (p.hp <= 0) this.hurtPlayer(1); }
      // heal at the nest
      const nd = Math.hypot(p.x - this.nest.x, p.y - this.nest.y);
      if (nd < 200) p.hp = Math.min(this.maxHp, p.hp + dt * 12);
      else p.hp = Math.min(this.maxHp, p.hp + dt * 0.8);

      // eat
      const st = this.stats;
      if (st.herb > 0) for (const f of this.fruit) {
        if (!f.eaten && Math.hypot(f.x - p.x, f.y - p.y) < this.radius + 8) {
          f.eaten = true; p.food = Math.min(100, p.food + 18 * Math.min(1, st.herb)); p.hp = Math.min(this.maxHp, p.hp + 5);
          s.dna += 3; this.addXp(2); sfx.eat(); this.fl.add(f.x, f.y, '+3🧬', '#9ef0ff', 12); s.stats.eaten++;
        }
      }
      if (st.carn > 0) for (const m of this.meat) {
        if (m.t > 0 && Math.hypot(m.x - p.x, m.y - p.y) < this.radius + 8) {
          m.t = 0; p.food = Math.min(100, p.food + 25 * Math.min(1, st.carn)); p.hp = Math.min(this.maxHp, p.hp + 8);
          s.dna += 4; this.addXp(2); sfx.eat(); this.fl.add(m.x, m.y, '+4🧬', '#9ef0ff', 12); s.stats.eaten++;
        }
      }
      // bones
      for (const b of this.bones) {
        if (!b.taken && Math.hypot(b.x - p.x, b.y - p.y) < this.radius + 20) this.takeBone(b);
      }
    }

    // --- encounter timer
    if (this.enc) {
      const e = this.enc;
      e.t -= dt;
      if (e.c.dead || Math.hypot(e.c.x - p.x, e.c.y - p.y) > 330) this.endEncounter(false, true);
      else if (e.t <= 0) { e.sp.friendship = Math.max(0, e.sp.friendship - 5); e.strikes++; sfx.bad(); if (e.strikes >= 3) this.endEncounter(false); else this.nextWant(); }
    }

    // --- fruit trees
    for (const tr of this.trees) {
      tr.fruitT -= dt;
      if (tr.fruitT <= 0) {
        tr.fruitT = rng.range(12, 30);
        const a = rng() * TAU;
        const f = { x: tr.x + Math.cos(a) * (tr.r + 6), y: tr.y + Math.sin(a) * (tr.r + 6), hue: tr.fruitHue };
        if (this.terrain.isLand(f.x, f.y) && this.fruit.length < 260) this.fruit.push(f);
      }
    }
    this.fruit = this.fruit.filter((f) => !f.eaten);
    for (const m of this.meat) m.t -= dt;
    this.meat = this.meat.filter((m) => m.t > 0);

    // --- NPCs
    for (const c of this.creatures) this.updateNpc(c, dt);
    for (const sp of this.species) sp.members = sp.members.filter((m) => !m.dead);
    // friendly nests slowly repopulate
    if (rng() < dt * 0.02) {
      const sp = rng.pick(this.species);
      if (sp.save.fate !== 'extinct' && sp.members.length && sp.members.length < 3) this.spawnMember(sp);
    }

    // --- projectiles
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      for (const c of this.creatures) {
        if (c.dead || c.ally) continue;
        if (Math.hypot(c.x - pr.x, c.y - pr.y) < c.r + 6) { this.hit(c, pr.dmg); pr.life = 0; break; }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0);

    this.fl.update(dt);
    this.px.update(dt);

    // camera
    this.cam.w = game.w; this.cam.h = game.h;
    if (inp.wheel) this.cam.zoom = clamp(this.cam.zoom * (inp.wheel > 0 ? 0.9 : 1.1), 0.5, 2.2);
    this.cam.x = lerp(this.cam.x, p.x, dt * 5);
    this.cam.y = lerp(this.cam.y, p.y, dt * 5);

    // hud
    this.hpBar(p.hp / this.maxHp, Math.max(0, Math.round(p.hp)) + ' / ' + Math.round(this.maxHp));
    this.foodBar(p.food / 100, Math.round(p.food) + '%');
    const b = this.brain;
    this.brainBar(b >= 5 ? 1 : (s.brainXp - BRAIN_XP[b - 1]) / (BRAIN_XP[b] - BRAIN_XP[b - 1]), 'Lv ' + b);
    this.dnaEl.innerHTML = `🧬 DNA <b>${fmt(s.dna)}</b>`;
    this.nextBtn.classList.toggle('hidden', b < 5);
    this.editBtn.classList.toggle('dim', Math.hypot(p.x - this.nest.x, p.y - this.nest.y) > 220);
    const canRecruit = this.allies.length < b && this.creatures.some((c) => !c.ally && c.sp?.save.fate === 'friend' && Math.hypot(c.x - p.x, c.y - p.y) < 200);
    this.recruitBtn.classList.toggle('hidden', !canRecruit);
    for (const k in this.abBtns) {
      const cd = p.cds[k] || 0;
      this.abBtns[k].querySelector('.cd').style.height = cd > 0 ? Math.min(100, cd / 2 * 100) + '%' : '0';
    }
    if (this.enc) {
      const e = this.enc;
      const lv = this.stats[e.want] || 0;
      this.encBox.innerHTML = `<div class="enc-name">${e.sp.name} との交流</div>
        <div class="enc-want">${ICON[e.want]} <b>${STAT_LABELS[e.want]}</b> をして！ <small>[${KEYS[e.want].slice(-1)}キー]</small> ${lv > 0 ? '' : '<span class="bad">（パーツがない）</span>'}</div>
        <div class="meter-track"><div class="meter-fill" style="width:${e.sp.friendship}%"></div></div>
        <div class="enc-timer" style="width:${e.t / 5 * 100}%"></div>
        <div class="enc-strikes">${'❌'.repeat(e.strikes)}${'⬜'.repeat(3 - e.strikes)}</div>`;
    }
  }

  updateNpc(c, dt) {
    if (c.dead) return;
    const p = this.player;
    c.cd -= dt; c.hurt = Math.max(0, c.hurt - dt * 3); c.act = Math.max(0, c.act - dt * 2);
    const dpl = Math.hypot(p.x - c.x, p.y - c.y);
    const sp = c.sp;
    const friend = sp?.save.fate === 'friend';
    let gx = null, gy = null, speed = c.speed * 0.5;

    // decide
    if (c.ally) {
      if (c.state === 'fight' && (!c.target || c.target.dead || (c.target !== p && Math.hypot(c.target.x - p.x, c.target.y - p.y) > 500))) c.state = 'follow';
      if (c.state !== 'fight') c.state = 'follow';
    } else if (c.state !== 'social') {
      if (!p.dead && !friend) {
        if (c.epic && dpl < 260) { c.state = 'fight'; c.target = p; }
        else if (sp?.hostile && sp.temper !== 'shy' && dpl < 420) { c.state = 'fight'; c.target = p; }
        else if (sp?.temper === 'aggressive' && dpl < 170 && !this.enc) { c.state = 'fight'; c.target = p; }
        else if (sp?.temper === 'shy' && (sp.hostile ? dpl < 300 : dpl < 90 && p.move > 0.5 && !this.enc)) c.state = 'flee';
      }
      if (c.state === 'fight' && (c.target === p && (p.dead || dpl > 600 || friend))) c.state = 'home';
      if (c.state === 'fight' && c.target !== p && (!c.target || c.target.dead)) c.state = 'home';
      if (c.state === 'flee' && dpl > 420) c.state = 'home';
    }

    if (c.state === 'social') {
      c.rot = turnTowards(c.rot, Math.atan2(p.y - c.y, p.x - c.x), 4 * dt);
      c.move = Math.max(0, c.move - dt * 3);
    } else if (c.state === 'follow') {
      const i = this.allies.indexOf(c);
      const a = p.rot + Math.PI + (i - (this.allies.length - 1) / 2) * 0.7;
      gx = p.x + Math.cos(a) * (70 + i * 10); gy = p.y + Math.sin(a) * (70 + i * 10);
      speed = Math.max(c.speed, this.speed) * (Math.hypot(gx - c.x, gy - c.y) > 80 ? 1.1 : 0.6);
      if (Math.hypot(gx - c.x, gy - c.y) < 20) gx = null;
      if (dpl > 900) { c.x = p.x - Math.cos(p.rot) * 60; c.y = p.y - Math.sin(p.rot) * 60; }
    } else if (c.state === 'fight') {
      const t = c.target;
      gx = t.x; gy = t.y; speed = c.speed * 1.05;
      const reach = (t === p ? this.radius : t.r) + c.r * 0.8;
      if (Math.hypot(t.x - c.x, t.y - c.y) < reach + 8) {
        gx = null;
        c.rot = turnTowards(c.rot, Math.atan2(t.y - c.y, t.x - c.x), 6 * dt);
        if (c.cd <= 0) {
          c.cd = c.epic ? 1.6 : 1.3;
          c.act = 1;
          if (t === p) this.hurtPlayer(c.dmg, c);
          else this.hit(t, c.dmg * (c.ally ? 1.2 : 1), c.ally);
        }
      }
    } else if (c.state === 'flee') {
      const a = Math.atan2(c.y - p.y, c.x - p.x);
      gx = c.x + Math.cos(a) * 100; gy = c.y + Math.sin(a) * 100; speed = c.speed * 1.1;
    } else {
      // home: wander around the nest, graze, and carnivores sometimes hunt
      c.wanderT -= dt;
      if (c.wanderT <= 0) {
        c.wanderT = rng.range(2, 6);
        const home = c.home;
        const a = rng() * TAU, r = rng.range(20, c.epic ? 500 : 200);
        c.wx = home.x + Math.cos(a) * r; c.wy = home.y + Math.sin(a) * r;
        c.rest = rng() < 0.35;
        // hungry carnivores pick on weaker neighbours
        if (sp && sp.diet !== 'herb' && rng() < 0.15) {
          for (const o of this.creatures) {
            if (o.sp && o.sp !== sp && !o.epic && !o.ally && o.sp.level < sp.level && Math.hypot(o.x - c.x, o.y - c.y) < 300) { c.state = 'fight'; c.target = o; break; }
          }
        }
      }
      if (!c.rest && c.wx != null) { gx = c.wx; gy = c.wy; if (Math.hypot(gx - c.x, gy - c.y) < 10) gx = null; }
    }

    if (gx != null) {
      const a = Math.atan2(gy - c.y, gx - c.x);
      c.rot = turnTowards(c.rot, a, 5 * dt);
      const moved = this.moveBody(c, Math.cos(c.rot) * speed * dt, Math.sin(c.rot) * speed * dt);
      if (!moved && c.state === 'home') c.wanderT = 0;
      c.phase += dt * speed / 9;
      c.move = Math.min(1, c.move + dt * 4);
    } else c.move = Math.max(0, c.move - dt * 4);

    // don't overlap the player
    if (dpl < c.r + this.radius * 0.8 && dpl > 0.01) {
      const push = (c.r + this.radius * 0.8 - dpl);
      this.moveBody(c, (c.x - p.x) / dpl * push, (c.y - p.y) / dpl * push);
    }
  }

  takeBone(b) {
    b.taken = true;
    const s = game.save;
    s.bonesTaken = [...(s.bonesTaken || []), b.id];
    const missing = CREATURE_PARTS.filter((t) => !s.unlocked.includes(t));
    sfx.part();
    this.addXp(20);
    if (missing.length) {
      const t = rng.pick(missing);
      s.unlocked.push(t);
      ui.toast(`🦴 骨の中から「<b>${PARTS[t].name}</b>」を発見！（${PARTS[t].desc}）巣のエディタで使えます`, 'good');
    } else { s.dna += 40; ui.toast('🦴 骨を調べた: DNA +40', 'good'); }
    game.persist();
  }

  draw(ctx) {
    const cam = this.cam;
    ctx.fillStyle = '#0e325c';
    ctx.fillRect(0, 0, game.w, game.h);
    ctx.save();
    cam.apply(ctx);
    this.terrain.draw(ctx);

    // nests
    const drawNest = (n, col) => {
      ctx.fillStyle = 'rgba(90,60,30,0.55)';
      ctx.beginPath(); ctx.ellipse(n.x, n.y, 70, 50, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,110,60,0.8)'; ctx.lineWidth = 5;
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; ctx.beginPath(); ctx.moveTo(n.x + Math.cos(a) * 45, n.y + Math.sin(a) * 32); ctx.lineTo(n.x + Math.cos(a + 0.8) * 68, n.y + Math.sin(a + 0.8) * 48); ctx.stroke(); }
      if (col) { ctx.fillStyle = col; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(n.x - 12 + i * 12, n.y + (i % 2) * 6, 7, 9, 0, 0, TAU); ctx.fill(); } }
    };
    drawNest(this.nest, hsl(this.design.hue, 40, 85));
    for (const sp of this.species) drawNest(sp.nest, sp.save.fate === 'extinct' ? null : hsl(sp.design.hue, 40, 85));

    for (const r of this.rocks) {
      if (!cam.visible(r.x, r.y, 30)) continue;
      ctx.fillStyle = '#8b8577'; ctx.strokeStyle = '#5b574d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.75, r.a, 0, TAU); ctx.fill(); ctx.stroke();
    }
    for (const b of this.bones) {
      if (b.taken || !cam.visible(b.x, b.y, 30)) continue;
      ctx.save(); ctx.translate(b.x, b.y);
      ctx.shadowColor = '#fff6a0'; ctx.shadowBlur = 12 + Math.sin(this.t * 3) * 6;
      ctx.strokeStyle = '#f3ecd6'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(14, 6); ctx.moveTo(-12, 8); ctx.lineTo(12, -8); ctx.stroke();
      ctx.fillStyle = '#f3ecd6'; ctx.beginPath(); ctx.arc(0, -14, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(-2.5, -15, 1.6, 0, TAU); ctx.arc(2.5, -15, 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const f of this.fruit) {
      if (!cam.visible(f.x, f.y, 10)) continue;
      ctx.fillStyle = hsl(f.hue, 80, 55); ctx.strokeStyle = hsl(f.hue, 60, 30); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, TAU); ctx.fill(); ctx.stroke();
    }
    for (const m of this.meat) {
      ctx.fillStyle = '#c9493f'; ctx.strokeStyle = '#6b1a14'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(m.x, m.y, 7, 5, 0.4, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f3ecd6'; ctx.fillRect(m.x + 4, m.y - 2, 6, 3);
    }

    // mates at the nest
    for (const m of this.mates) {
      m.phase += 0.02;
      drawCreature(ctx, this.design, m.x, m.y, m.rot + Math.sin(m.phase) * 0.3, 0.8, { phase: m.phase });
    }

    const list = this.creatures.filter((c) => cam.visible(c.x, c.y, c.r + 40));
    list.sort((a, b) => a.scale - b.scale);
    for (const c of list) {
      if (c === this.selected) {
        ctx.strokeStyle = c.sp?.save.fate === 'friend' ? '#7f7' : '#ffd84a'; ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r + 10, (c.r + 10) * 0.8, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (c.ally) { ctx.fillStyle = 'rgba(120,255,140,0.25)'; ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 6, 0, TAU); ctx.fill(); }
      drawCreature(ctx, c.design, c.x, c.y, c.rot, c.scale, { phase: c.phase, move: c.move, hurt: c.hurt, act: c.act });
      if (c.hp < c.maxHp) bar(ctx, c.x, c.y - c.r - 12, 40, c.hp / c.maxHp);
      if (c.state === 'fight' && c.target === this.player) { ctx.fillStyle = '#ff5050'; ctx.font = 'bold 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', c.x, c.y - c.r - 16); }
    }

    const p = this.player;
    if (!p.dead) {
      drawCreature(ctx, this.design, p.x, p.y, p.rot, 1, { phase: p.phase, move: p.move, hurt: p.hurt, act: p.act, alpha: p.inv > 0 ? 0.6 : 1 });
    }
    if (p.goal && !p.goal.c) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.goal.x, p.goal.y, 8 + Math.sin(this.t * 6) * 2, 0, TAU); ctx.stroke();
    }

    // encounter bubble
    if (this.enc) {
      const c = this.enc.c;
      const bx = c.x, by = c.y - c.r - 40;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.ellipse(bx, by, 24, 20, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 16); ctx.lineTo(bx, by + 28); ctx.lineTo(bx + 6, by + 16); ctx.fill();
      ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ICON[this.enc.want], bx, by + 1);
      ctx.textBaseline = 'alphabetic';
    }

    for (const pr of this.projectiles) {
      ctx.fillStyle = '#8fdc3a'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 6, 0, TAU); ctx.fill();
    }

    // tree canopies over everything on the ground
    for (const tr of this.trees) {
      if (!cam.visible(tr.x, tr.y, tr.r + 10)) continue;
      const near = Math.hypot(tr.x - p.x, tr.y - p.y) < tr.r + 20;
      ctx.globalAlpha = near ? 0.45 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.arc(tr.x + 6, tr.y + 8, tr.r, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(tr.hue, 45, 28); ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(tr.hue, 45, 36); ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.2, tr.y - tr.r * 0.2, tr.r * 0.7, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(tr.fruitHue, 75, 55);
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + tr.x; ctx.beginPath(); ctx.arc(tr.x + Math.cos(a) * tr.r * 0.5, tr.y + Math.sin(a) * tr.r * 0.5, 3.5, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    this.px.draw(ctx);
    this.fl.draw(ctx, cam.zoom);
    ctx.restore();

    if (p.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, game.w, game.h);
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const m = this.mini, c = m.getContext('2d');
    const S = 150, k = S / SIZE;
    c.clearRect(0, 0, S, S);
    this.terrain.drawMini(c, 0, 0, S);
    c.font = '11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('🏠', this.nest.x * k, this.nest.y * k);
    for (const sp of this.species) {
      if (sp.save.fate === 'extinct') continue;
      c.fillStyle = sp.save.fate === 'friend' ? '#6f6' : sp.hostile ? '#f55' : hsl(sp.design.hue, 70, 60);
      c.beginPath(); c.arc(sp.nest.x * k, sp.nest.y * k, 4, 0, TAU); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    }
    for (const b of this.bones) if (!b.taken) { c.fillStyle = '#fff'; c.fillRect(b.x * k - 1.5, b.y * k - 1.5, 3, 3); }
    if (this.epic) { c.fillStyle = '#f00'; c.fillText('💀', this.epic.x * k, this.epic.y * k); }
    const p = this.player;
    c.fillStyle = '#ff0'; c.beginPath(); c.arc(p.x * k, p.y * k, 3.5, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.strokeRect((this.cam.x - game.w / 2 / this.cam.zoom) * k, (this.cam.y - game.h / 2 / this.cam.zoom) * k, game.w / this.cam.zoom * k, game.h / this.cam.zoom * k);
  }
}

function bar(ctx, x, y, w, f) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = f > 0.5 ? '#6f6' : f > 0.25 ? '#fd4' : '#f55'; ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 5);
}
