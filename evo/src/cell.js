// Cell stage: swim in the primordial soup, eat, grow, avoid being eaten.

import { game } from './game.js';
import { ui, Floaters, Particles } from './ui.js';
import { sfx } from './audio.js';
import { TAU, clamp, lerp, rng, angleDiff, turnTowards, Camera, hsl, fmt } from './util.js';
import { PARTS, computeStats, drawCreature, randomDesign, designRadius } from './creature.js';

const WORLD_R = 2600;
const GROWTH_PER_LEVEL = [0, 30, 45, 65, 90];   // food needed to reach next level
const MAX_LEVEL = 5;
const CELL_PARTS = Object.keys(PARTS).filter((t) => PARTS[t].stage === 'cell');

export class CellScene {
  constructor() {
    const s = game.save;
    this.design = s.cellDesign;
    this.cam = new Camera();
    this.fl = new Floaters();
    this.px = new Particles();
    this.level = s.cellLevel || 1;
    this.growth = s.cellGrowth || 0;
    this.player = null;
    this.cells = [];
    this.food = [];
    this.clouds = [];
    this.pickups = [];
    this.t = 0;
    this.spawnT = 0;
    this.bg = makeBackdrop();
  }

  enter() {
    this.applyDesign();
    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, rot: 0, phase: 0, hp: this.maxHp, hurt: 0, biteCd: 0,
      zapCd: 0, poisonCd: 0, dead: 0,
    };
    for (let i = 0; i < 380; i++) this.spawnFood(true);
    for (let i = 0; i < 26; i++) this.spawnCell(true);
    for (let i = 0; i < 3; i++) this.spawnPickup(true);
    this.buildHud();
    ui.toast('マウス（またはタップ）の方向へ泳ぎます。WASDでも動けます');
    const diet = this.stats.diet;
    ui.toast(diet === 'herb' ? '緑の植物プランクトンを食べて大きくなろう' : diet === 'carn' ? '赤い肉片や小さな細胞を食べよう' : '何でも食べて大きくなろう');
  }

  applyDesign() {
    this.stats = computeStats(this.design);
    this.radius = designRadius(this.design);
    this.maxHp = 40 + this.stats.mass / 6 + this.level * 12;
    this.speed = 70 + this.stats.speed * 42 + this.stats.turn * 10;
    this.turnRate = 3 + this.stats.turn * 1.2 + this.stats.speed * 0.3;
  }

  get scale() { return 0.9 + (this.level - 1) * 0.28 + (this.growth / GROWTH_PER_LEVEL[Math.min(this.level, 4)] || 0) * 0.2; }

  buildHud() {
    const top = ui.el('div', 'hud top-left');
    ui.el('div', 'stage-name', top, '細胞期');
    this.hpBar = ui.meter(top, '体力', 'hp');
    this.grBar = ui.meter(top, '成長', 'grow');
    this.dnaEl = ui.el('div', 'dna', top);
    const right = ui.el('div', 'hud top-right');
    ui.button('🧬 進化する（エディタ）', '', () => this.openEditor(), right);
    this.nextBtn = ui.button('🌍 陸へあがる！', 'primary hidden', () => this.finish(), right);
    ui.button('⏸', 'small', () => game.go('title'), right).title = 'タイトルへ';
    const bottom = ui.el('div', 'hud bottom-center');
    this.abil = ui.el('div', 'abilities', bottom);
    this.refreshAbilities();
  }

  refreshAbilities() {
    this.abil.innerHTML = '';
    if (this.stats.shock > 0) ui.button('⚡ 電撃 [Space]', 'small', () => this.zap(), this.abil);
    if (this.stats.poison > 0) ui.button('☁ 毒 [Shift]', 'small', () => this.dropPoison(), this.abil);
  }

  openEditor() {
    const s = game.save;
    s.cellLevel = this.level; s.cellGrowth = this.growth;
    game.go('editor', {
      kind: 'cell', design: this.design, dna: s.dna, unlocked: s.unlocked, title: '細胞エディタ',
      onDone: (d, dna) => { s.cellDesign = d; s.dna = dna; game.persist(); game.go('cell'); },
    });
  }

  finish() {
    const s = game.save;
    s.traits.cell = this.stats.diet === 'none' ? 'omni' : this.stats.diet;
    s.cellLevel = 1; s.cellGrowth = 0;
    game.persist();
    game.go('cellOutro');
  }

  // --- spawning
  spawnFood(anywhere) {
    const p = this.randomPos(anywhere);
    const meat = rng() < 0.25;
    this.food.push({ x: p.x, y: p.y, meat, r: meat ? rng.range(3, 6) : rng.range(3, 7), a: rng() * TAU, vr: rng.range(-1, 1), val: meat ? 4 : 3 });
  }
  spawnPickup(anywhere) {
    const p = this.randomPos(anywhere);
    this.pickups.push({ x: p.x, y: p.y, t: rng() * 10 });
  }
  randomPos(anywhere) {
    const pl = this.player || { x: 0, y: 0 };
    for (let tries = 0; tries < 20; tries++) {
      const a = rng() * TAU;
      const d = anywhere ? Math.sqrt(rng()) * WORLD_R : rng.range(700, 1100) / Math.max(0.6, this.cam.zoom);
      const x = anywhere ? Math.cos(a) * d : pl.x + Math.cos(a) * d;
      const y = anywhere ? Math.sin(a) * d : pl.y + Math.sin(a) * d;
      if (Math.hypot(x, y) < WORLD_R - 30 && (!anywhere || Math.hypot(x - pl.x, y - pl.y) > 250)) return { x, y };
    }
    return { x: rng.range(-500, 500), y: rng.range(-500, 500) };
  }

  spawnCell(anywhere) {
    const lvl = this.level;
    // Size tier relative to the player: prey, peers, predators.
    const roll = rng();
    const rel = roll < 0.5 ? rng.range(0.45, 0.8) : roll < 0.85 ? rng.range(0.85, 1.2) : rng.range(1.35, 2.2);
    const diet = rel > 1.3 ? (rng() < 0.8 ? 'carn' : 'omni') : rng.pick(['herb', 'herb', 'carn', 'omni']);
    const d = randomDesign(rng.int(1, 1e9), 'cell', diet, lvl * 0.4 + (rel > 1.3 ? 1 : 0));
    const st = computeStats(d);
    const p = this.randomPos(anywhere);
    const scale = this.scale * rel;
    const r = designRadius(d) * scale;
    this.cells.push({
      x: p.x, y: p.y, vx: 0, vy: 0, rot: rng() * TAU, phase: rng() * 10, design: d, stats: st, scale, r,
      hp: (20 + st.mass / 8) * rel * (0.6 + lvl * 0.25), maxHp: 0, speed: (55 + st.speed * 30) * (0.7 + rng() * 0.3),
      aggro: diet !== 'herb' && rel > 0.9, hurt: 0, biteCd: 0, target: null, wander: rng() * TAU, fleeT: 0,
    });
    const c = this.cells[this.cells.length - 1];
    c.maxHp = c.hp;
  }

  // --- abilities
  zap() {
    const p = this.player;
    if (this.stats.shock <= 0 || p.zapCd > 0 || p.dead) return;
    p.zapCd = 3.5;
    const R = this.radius * this.scale * 3.2;
    sfx.zap();
    this.px.burst(p.x, p.y, '#ffe14a', 24, R * 1.6, 0.4, 2.5);
    this.zapFx = { x: p.x, y: p.y, R, t: 0.3 };
    for (const c of this.cells) {
      if (Math.hypot(c.x - p.x, c.y - p.y) < R + c.r) this.damageCell(c, 10 + this.stats.shock * 8, true);
    }
  }
  dropPoison() {
    const p = this.player;
    if (this.stats.poison <= 0 || p.poisonCd > 0 || p.dead) return;
    p.poisonCd = 0.6;
    const back = p.rot + Math.PI;
    this.clouds.push({ x: p.x + Math.cos(back) * this.radius * this.scale, y: p.y + Math.sin(back) * this.radius * this.scale, r: 18 * this.scale, t: 0, life: 4, dps: 6 + this.stats.poison * 5 });
  }

  damageCell(c, dmg, fromPlayer) {
    c.hp -= dmg;
    c.hurt = 1;
    c.fleeT = 2;
    if (fromPlayer) { this.fl.add(c.x, c.y - c.r, '-' + Math.round(dmg), '#ffd36b'); c.aggro = c.aggro || c.stats.bite > 0; }
    sfx.hit();
    if (c.hp <= 0 && !c.dead) {
      c.dead = true;
      // Drop meat, and occasionally a part the player hasn't found yet.
      for (let i = 0; i < 3 + Math.floor(c.scale * 2); i++) {
        this.food.push({ x: c.x + rng.range(-c.r, c.r), y: c.y + rng.range(-c.r, c.r), meat: true, r: rng.range(3, 6), a: rng() * TAU, vr: rng.range(-1, 1), val: 4 });
      }
      this.px.burst(c.x, c.y, hsl(c.design.hue, 60, 60), 14, 90);
      if (fromPlayer) {
        game.save.stats.kills++;
        const newPart = c.design.parts.map((p) => p.type).find((t) => !game.save.unlocked.includes(t));
        if (newPart && rng() < 0.6) this.pickups.push({ x: c.x, y: c.y, t: 0, type: newPart });
      }
    }
  }

  hurtPlayer(dmg, from) {
    const p = this.player;
    if (p.dead || p.inv > 0) return;
    p.hp -= dmg;
    p.hurt = 1;
    sfx.hurt();
    this.fl.add(p.x, p.y - this.radius * this.scale, '-' + Math.round(dmg), '#ff6b6b');
    if (from) { const a = Math.atan2(p.y - from.y, p.x - from.x); p.vx += Math.cos(a) * 120; p.vy += Math.sin(a) * 120; }
    if (p.hp <= 0) {
      p.dead = 2.5;
      sfx.die();
      this.px.burst(p.x, p.y, hsl(this.design.hue, 60, 60), 30, 120, 1);
      this.growth = Math.max(0, this.growth - 10);
      ui.toast('食べられてしまった…　新しい個体として生まれ変わります', 'bad');
    }
  }

  eat(f) {
    const st = this.stats;
    const k = f.meat ? st.carn : st.herb;
    if (k <= 0) return false;
    const gain = f.val * Math.min(1.2, k);
    this.growth += gain;
    const s = game.save;
    s.dna += Math.round(f.val * 1.5);
    s.stats.eaten++;
    this.player.hp = Math.min(this.maxHp, this.player.hp + 3);
    this.fl.add(f.x, f.y, '+' + Math.round(f.val * 1.5) + '🧬', '#9ef0ff', 12);
    sfx.eat();
    this.px.burst(f.x, f.y, f.meat ? '#ff8a7a' : '#8dff9a', 5, 40, 0.3, 2);
    this.checkLevel();
    return true;
  }

  checkLevel() {
    if (this.level >= MAX_LEVEL) { this.growth = Math.min(this.growth, 1); return; }
    const need = GROWTH_PER_LEVEL[this.level];
    if (this.growth >= need) {
      this.growth -= need;
      this.level++;
      this.applyDesign();
      this.player.hp = this.maxHp;
      sfx.level();
      if (this.level >= MAX_LEVEL) {
        ui.toast('<b>十分に成長した！</b>「陸へあがる」で次の段階へ進化できます', 'good');
        this.nextBtn.classList.remove('hidden');
      } else {
        ui.toast(`<b>成長レベル ${this.level}</b>　体が大きくなった！`, 'good');
      }
      // bigger cells replace the ones we can now swallow
      for (const c of this.cells) if (c.scale < this.scale * 0.3) c.gone = true;
    }
  }

  update(dt) {
    const inp = game.input;
    const p = this.player;
    this.t += dt;
    game.save.stats.time += dt;
    const sc = this.scale;
    const R = this.radius * sc;

    if (inp.wasPressed('Space')) this.zap();
    if (inp.isDown('ShiftLeft', 'ShiftRight')) this.dropPoison();
    if (inp.wasPressed('KeyE')) this.openEditor();

    // --- player movement
    p.zapCd -= dt; p.poisonCd -= dt; p.biteCd -= dt; p.hurt = Math.max(0, p.hurt - dt * 3); p.inv = (p.inv || 0) - dt; p.spikeCd = (p.spikeCd || 0) - dt;
    let thrust = 0, want = p.rot;
    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) {
        p.dead = 0; p.hp = this.maxHp; p.inv = 2;
        const np = this.randomPos(true); p.x = np.x; p.y = np.y; p.vx = p.vy = 0;
      }
    } else {
      const ax = inp.axis();
      if (ax.x || ax.y) { want = Math.atan2(ax.y, ax.x); thrust = 1; }
      else if (inp.mouse.down) {
        const w = this.cam.toWorld(inp.mouse.x, inp.mouse.y);
        const d = Math.hypot(w.x - p.x, w.y - p.y);
        if (d > R * 0.5) { want = Math.atan2(w.y - p.y, w.x - p.x); thrust = clamp(d / (R * 4), 0.3, 1); }
      }
    }
    p.rot = turnTowards(p.rot, want, this.turnRate * dt);
    const align = Math.max(0.2, Math.cos(angleDiff(p.rot, want)));
    const acc = this.speed * 3 * thrust * align;
    p.vx += Math.cos(p.rot) * acc * dt;
    p.vy += Math.sin(p.rot) * acc * dt;
    const drag = Math.pow(0.05, dt);
    p.vx *= drag; p.vy *= drag;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const pd = Math.hypot(p.x, p.y);
    if (pd > WORLD_R - R) { p.x *= (WORLD_R - R) / pd; p.y *= (WORLD_R - R) / pd; }
    const spd = Math.hypot(p.vx, p.vy);
    p.phase += dt * (2 + spd / 25);
    p.move = clamp(spd / 80, 0, 1);

    // --- mouth position for eating/biting
    const head = this.design.spine[0];
    const mx = p.x + Math.cos(p.rot) * (head.x + head.r) * sc, my = p.y + Math.sin(p.rot) * (head.x + head.r) * sc;

    if (!p.dead) {
      for (const f of this.food) {
        if (f.eaten) continue;
        const dm = Math.hypot(f.x - mx, f.y - my);
        const db = Math.hypot(f.x - p.x, f.y - p.y);
        if (dm < f.r + 8 * sc || db < R * 0.6) { if (this.eat(f)) f.eaten = true; }
      }
      for (const k of this.pickups) {
        if (Math.hypot(k.x - p.x, k.y - p.y) < R + 14) { k.taken = true; this.takePickup(k); }
      }
    }

    // --- NPC cells
    const player = p;
    for (const c of this.cells) {
      if (c.dead) continue;
      c.hurt = Math.max(0, c.hurt - dt * 3);
      c.biteCd -= dt; c.fleeT -= dt;
      const dx = player.x - c.x, dy = player.y - c.y, dpl = Math.hypot(dx, dy);
      let want = c.wander, thr = 0.35;
      const bigger = c.scale > sc * 1.1, smaller = c.scale < sc * 0.9;
      if (!player.dead && dpl < 420 * sc) {
        if (c.aggro && !smaller && c.stats.bite > 0) { want = Math.atan2(dy, dx); thr = 1; }
        else if ((smaller || c.fleeT > 0) && dpl < 260 * sc) { want = Math.atan2(-dy, -dx); thr = 1; }
      }
      if (thr < 1) {
        // graze: drift to the nearest food of its diet
        if (!c.foodT || c.foodT.eaten || rng() < 0.005) {
          c.foodT = null;
          let best = 250 * c.scale;
          for (const f of this.food) {
            if (f.eaten) continue;
            if ((f.meat ? c.stats.carn : c.stats.herb) <= 0) continue;
            const dd = Math.abs(f.x - c.x) + Math.abs(f.y - c.y);
            if (dd < best) { best = dd; c.foodT = f; }
          }
        }
        if (c.foodT) {
          want = Math.atan2(c.foodT.y - c.y, c.foodT.x - c.x); thr = 0.6;
          if (Math.hypot(c.foodT.x - c.x, c.foodT.y - c.y) < c.r) { c.foodT.eaten = true; c.foodT = null; }
        } else if (rng() < dt * 0.4) c.wander += rng.range(-1.5, 1.5);
      }
      if (Math.hypot(c.x, c.y) > WORLD_R - 200) want = Math.atan2(-c.y, -c.x);
      c.rot = turnTowards(c.rot, want, 3 * dt);
      c.vx += Math.cos(c.rot) * c.speed * 2.6 * thr * dt;
      c.vy += Math.sin(c.rot) * c.speed * 2.6 * thr * dt;
      c.vx *= drag; c.vy *= drag;
      c.x += c.vx * dt; c.y += c.vy * dt;
      const cs = Math.hypot(c.vx, c.vy);
      c.phase += dt * (2 + cs / 25);
      c.move = clamp(cs / 80, 0, 1);

      // contact with player
      if (!player.dead && dpl < c.r + R * 0.85) {
        const toC = Math.atan2(-dy, -dx);
        // player bites what is in front of its mouth
        if (this.stats.bite > 0 && player.biteCd <= 0 && Math.abs(angleDiff(player.rot, toC)) < 0.9) {
          player.biteCd = 0.45;
          this.damageCell(c, 5 + this.stats.bite * 7 * sc / c.scale * 0.8 + this.level * 2, true);
          this.biteFx = 0.2;
        }
        // cell bites player
        if (c.stats.bite > 0 && c.biteCd <= 0 && c.aggro && Math.abs(angleDiff(c.rot, Math.atan2(dy, dx))) < 1.0) {
          c.biteCd = 0.8;
          this.hurtPlayer((4 + c.stats.bite * 5) * c.scale / sc, c);
        }
        // spikes hurt whoever touches them
        if (this.stats.spike > 0 && (c.spikeCd || 0) <= 0) { c.spikeCd = 0.5; this.damageCell(c, 3 + this.stats.spike * 5 * sc / c.scale, true); }
        c.spikeCd = (c.spikeCd || 0) - dt;
        if (c.stats.spike > 0 && (player.spikeCd || 0) <= 0) { player.spikeCd = 0.6; this.hurtPlayer((2 + c.stats.spike * 3) * c.scale / sc, c); }
        // push apart
        const ov = c.r + R * 0.85 - dpl;
        if (ov > 0 && dpl > 0.01) {
          const nx = dx / dpl, ny = dy / dpl;
          const mp = c.scale / (c.scale + sc);
          player.x += nx * ov * mp; player.y += ny * ov * mp;
          c.x -= nx * ov * (1 - mp); c.y -= ny * ov * (1 - mp);
        }
      }
    }

    // NPC predators also snack on smaller NPCs (a living ecosystem)
    if (rng() < 0.2) {
      for (const a of this.cells) {
        if (a.dead || a.stats.carn <= 0 || !a.aggro) continue;
        for (const b of this.cells) {
          if (b === a || b.dead || b.scale > a.scale * 0.8) continue;
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < a.r + b.r) { b.dead = true; this.px.burst(b.x, b.y, '#ff8a7a', 8, 60); }
        }
      }
    }

    // poison clouds
    for (const cl of this.clouds) {
      cl.t += dt;
      cl.r += dt * 6;
      for (const c of this.cells) if (!c.dead && Math.hypot(c.x - cl.x, c.y - cl.y) < cl.r + c.r) {
        c.hp -= cl.dps * dt; c.hurt = 0.6; c.fleeT = 2;
        if (c.hp <= 0) this.damageCell(c, 0, true);
      }
    }
    this.clouds = this.clouds.filter((c) => c.t < c.life);

    // housekeeping
    this.food = this.food.filter((f) => !f.eaten);
    this.cells = this.cells.filter((c) => !c.dead && !c.gone && Math.hypot(c.x - p.x, c.y - p.y) < 2400 * sc);
    this.pickups = this.pickups.filter((k) => !k.taken);
    for (const f of this.food) { f.a += f.vr * dt; }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.25;
      if (this.food.length < 420) { this.spawnFood(false); this.spawnFood(false); }
      if (this.cells.length < 24 + this.level * 2) this.spawnCell(false);
      if (this.pickups.length < 2 && rng() < 0.05) this.spawnPickup(false);
    }
    if (this.zapFx) { this.zapFx.t -= dt; if (this.zapFx.t <= 0) this.zapFx = null; }
    this.biteFx = Math.max(0, (this.biteFx || 0) - dt);
    this.fl.update(dt);
    this.px.update(dt);

    // camera
    this.cam.w = game.w; this.cam.h = game.h;
    const targetZoom = Math.min(game.w, game.h) / (520 * sc) * (1 + this.stats.sight * 0.06) * 0.85;
    this.cam.zoom = lerp(this.cam.zoom, clamp(targetZoom, 0.3, 3), dt * 2);
    this.cam.x = lerp(this.cam.x, p.x, dt * 5);
    this.cam.y = lerp(this.cam.y, p.y, dt * 5);

    // hud
    this.hpBar(p.hp / this.maxHp, Math.max(0, Math.round(p.hp)) + ' / ' + Math.round(this.maxHp));
    const need = GROWTH_PER_LEVEL[Math.min(this.level, 4)];
    this.grBar(this.level >= MAX_LEVEL ? 1 : this.growth / need, 'Lv ' + this.level + (this.level >= MAX_LEVEL ? ' MAX' : ''));
    this.dnaEl.innerHTML = `🧬 DNA <b>${fmt(game.save.dna)}</b>`;
  }

  takePickup(k) {
    const s = game.save;
    const missing = CELL_PARTS.filter((t) => !s.unlocked.includes(t));
    const type = k.type && !s.unlocked.includes(k.type) ? k.type : missing.length ? rng.pick(missing) : null;
    sfx.part();
    if (type) {
      s.unlocked.push(type);
      ui.toast(`🧩 新しいパーツ「<b>${PARTS[type].name}</b>」を発見！エディタで使えます`, 'good');
    } else {
      s.dna += 25;
      ui.toast('隕石のかけら: DNA +25', 'good');
    }
    game.persist();
  }

  draw(ctx) {
    const cam = this.cam;
    drawBackdrop(ctx, this.bg, cam, this.t);
    ctx.save();
    cam.apply(ctx);

    // world edge
    ctx.strokeStyle = 'rgba(160,220,255,0.15)';
    ctx.lineWidth = 30;
    ctx.beginPath(); ctx.arc(0, 0, WORLD_R + 15, 0, TAU); ctx.stroke();

    for (const f of this.food) {
      if (!cam.visible(f.x, f.y, 20)) continue;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
      if (f.meat) {
        ctx.fillStyle = '#e8605a'; ctx.strokeStyle = '#8c2420'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-f.r, -f.r * 0.6); ctx.lineTo(f.r, -f.r * 0.8); ctx.lineTo(f.r * 0.7, f.r); ctx.lineTo(-f.r * 0.9, f.r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#5fd46a'; ctx.strokeStyle = '#1f6b2a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, f.r, f.r * 0.55, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#b8ffb0'; ctx.beginPath(); ctx.arc(-f.r * 0.3, 0, f.r * 0.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    for (const k of this.pickups) {
      k.t += 0.016;
      ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.t);
      ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#a58b5a'; ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, rr = 12 + (i % 2) * 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    for (const cl of this.clouds) {
      ctx.fillStyle = `rgba(130,230,70,${0.35 * (1 - cl.t / cl.life)})`;
      ctx.beginPath(); ctx.arc(cl.x, cl.y, cl.r, 0, TAU); ctx.fill();
    }

    const p = this.player;
    const all = [...this.cells];
    all.sort((a, b) => a.scale - b.scale);
    for (const c of all) {
      if (!cam.visible(c.x, c.y, c.r + 40)) continue;
      drawCreature(ctx, c.design, c.x, c.y, c.rot, c.scale, { phase: c.phase, move: c.move, hurt: c.hurt });
      // danger ring for predators
      if (c.aggro && c.scale > this.scale * 1.1) {
        ctx.strokeStyle = 'rgba(255,80,80,0.35)'; ctx.lineWidth = 2 / cam.zoom;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 6, 0, TAU); ctx.stroke();
      }
      if (c.hp < c.maxHp) bar(ctx, c.x, c.y - c.r - 8, 30 / cam.zoom * 0.8, c.hp / c.maxHp, cam.zoom);
    }
    if (!p.dead) {
      drawCreature(ctx, this.design, p.x, p.y, p.rot, this.scale, { phase: p.phase, move: p.move, hurt: p.hurt, act: this.biteFx * 5, alpha: p.inv > 0 ? 0.5 + 0.5 * Math.sin(this.t * 20) : 1 });
    }
    if (this.zapFx) {
      const z = this.zapFx;
      ctx.strokeStyle = `rgba(255,240,120,${z.t / 0.3})`; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU, rr = z.R * (0.8 + Math.random() * 0.3); ctx.lineTo(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr); }
      ctx.stroke();
    }
    this.px.draw(ctx);
    this.fl.draw(ctx, cam.zoom);
    ctx.restore();

    // foreground plankton for depth
    ctx.fillStyle = 'rgba(200,240,255,0.08)';
    for (const m of this.bg.front) {
      const x = ((m.x - cam.x * 1.6) % game.w + game.w) % game.w;
      const y = ((m.y - cam.y * 1.6) % game.h + game.h) % game.h;
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
    }
  }
}

function bar(ctx, x, y, w, f, zoom) {
  const h = 4 / zoom;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = f > 0.5 ? '#6f6' : f > 0.25 ? '#fd4' : '#f55'; ctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), h);
}

function makeBackdrop() {
  const far = [], mid = [], front = [];
  for (let i = 0; i < 40; i++) far.push({ x: rng() * 3000, y: rng() * 3000, r: rng.range(30, 120), h: rng.int(150, 220) });
  for (let i = 0; i < 90; i++) mid.push({ x: rng() * 3000, y: rng() * 3000, r: rng.range(1, 3) });
  for (let i = 0; i < 25; i++) front.push({ x: rng() * 2000, y: rng() * 2000, r: rng.range(6, 20) });
  return { far, mid, front };
}

function drawBackdrop(ctx, bg, cam, t) {
  const w = game.w, h = game.h;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0f4a63'); g.addColorStop(1, '#062030');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // light rays
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#bff';
  for (let i = 0; i < 5; i++) {
    const x = ((i * 380 - cam.x * 0.05 + Math.sin(t * 0.2 + i) * 40) % (w + 400) + w + 400) % (w + 400) - 200;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 120, 0); ctx.lineTo(x + 300, h); ctx.lineTo(x + 140, h); ctx.fill();
  }
  ctx.restore();
  for (const m of bg.far) {
    const x = ((m.x - cam.x * 0.15) % 3000 + 3000) % 3000 - 500;
    const y = ((m.y - cam.y * 0.15) % 3000 + 3000) % 3000 - 500;
    if (x < -150 || x > w + 150 || y < -150 || y > h + 150) continue;
    ctx.fillStyle = `hsla(${m.h},50%,40%,0.12)`;
    ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(200,240,255,0.25)';
  for (const m of bg.mid) {
    const x = ((m.x - cam.x * 0.4) % 3000 + 3000) % 3000 - 500;
    const y = ((m.y - cam.y * 0.4) % 3000 + 3000) % 3000 - 500;
    if (x < 0 || x > w || y < 0 || y > h) continue;
    ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
  }
}

