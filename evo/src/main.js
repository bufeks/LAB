// Entry point: canvas setup, the main loop, and the small "glue" scenes
// (title, stage cards, cell->land transition, ending).

import { game } from './game.js';
import { Input } from './input.js';
import { ui } from './ui.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';
import { TAU, rng, hsl, fmt } from './util.js';
import { newSave, loadSave, clearSave, STAGES, STAGE_NAMES, TRAITS } from './save.js';
import { starterCell, cellToCreature, randomDesign, drawCreature, START_PARTS, computeStats } from './creature.js';
import { EditorScene } from './editor.js';
import { CellScene } from './cell.js';
import { CreatureScene } from './creatureStage.js';
import { TribeScene } from './tribe.js';
import { CivScene } from './civ.js';
import { SpaceScene } from './space.js';

const canvas = document.getElementById('game');
game.canvas = canvas;
game.ctx = canvas.getContext('2d');
game.input = new Input(canvas);

function resize() {
  game.dpr = Math.min(2, window.devicePixelRatio || 1);
  game.w = window.innerWidth;
  game.h = window.innerHeight;
  canvas.width = Math.round(game.w * game.dpr);
  canvas.height = Math.round(game.h * game.dpr);
}
addEventListener('resize', resize);
resize();
addEventListener('pointerdown', unlockAudio, { once: true });

// ---------------------------------------------------------------- title

class TitleScene {
  constructor() {
    this.t = 0;
    this.fish = [];
    for (let i = 0; i < 16; i++) {
      this.fish.push({
        d: randomDesign(rng.int(1, 1e9), i % 3 ? 'cell' : 'creature', rng.pick(['herb', 'carn', 'omni']), 1),
        x: rng() * game.w, y: rng() * game.h, rot: rng() * TAU, s: rng.range(0.6, 1.6), sp: rng.range(15, 40), phase: rng() * 10,
      });
    }
  }
  enter() {
    const save = loadSave();
    const box = ui.el('div', 'title-menu');
    ui.el('h1', 'logo', box, 'EVO<span>いのちの旅</span>');
    ui.el('p', 'tagline', box, '一つの細胞から、銀河の中心まで。');
    if (save) {
      ui.button(`▶ つづきから <small>${save.stage === 'done' ? 'クリア済み' : STAGE_NAMES[save.stage]}</small>`, 'primary big', () => { game.save = save; resume(); }, box);
    }
    ui.button('✦ はじめから', save ? 'big' : 'primary big', () => {
      if (save) ui.modal('はじめから？', '<p>今のセーブデータは消えます。よろしいですか？</p>', [{ label: 'はじめる', cls: 'danger', onClick: () => newGame() }, { label: 'やめる' }]);
      else newGame();
    }, box);
    if (save && save.reached.length > 1) {
      const row = ui.el('div', 'stage-select', box, '<span>ステージを選ぶ:</span>');
      for (const st of STAGES) {
        const b = ui.button(STAGE_NAMES[st], 'small', () => { game.save = save; game.startStage(st); }, row);
        if (!save.reached.includes(st)) b.disabled = true;
      }
    }
    const m = ui.button(isMuted() ? '🔇 音: OFF' : '🔊 音: ON', 'small ghost', () => {
      setMuted(!isMuted());
      m.textContent = isMuted() ? '🔇 音: OFF' : '🔊 音: ON';
    }, box);
    ui.el('p', 'credit', box, '細胞期 → クリーチャー期 → 部族期 → 文明期 → 宇宙期<br><small>マウス・キーボード推奨（タッチでも遊べます）</small>');
  }
  update(dt) {
    this.t += dt;
    for (const f of this.fish) {
      f.rot += Math.sin(this.t * 0.5 + f.phase) * dt * 0.5;
      f.x += Math.cos(f.rot) * f.sp * dt; f.y += Math.sin(f.rot) * f.sp * dt;
      f.phase += dt * 3;
      if (f.x < -80) f.x = game.w + 80; if (f.x > game.w + 80) f.x = -80;
      if (f.y < -80) f.y = game.h + 80; if (f.y > game.h + 80) f.y = -80;
    }
  }
  draw(ctx) {
    const g = ctx.createRadialGradient(game.w / 2, game.h * 0.4, 50, game.w / 2, game.h / 2, Math.max(game.w, game.h));
    g.addColorStop(0, '#15506b'); g.addColorStop(0.6, '#0a2236'); g.addColorStop(1, '#03060d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, game.w, game.h);
    ctx.globalAlpha = 0.4;
    for (const f of this.fish) drawCreature(ctx, f.d, f.x, f.y, f.rot, f.s, { phase: f.phase, move: 0.8 });
    ctx.globalAlpha = 1;
  }
}

function newGame() {
  ui.modal('最初の細胞', '<p>どんな生き物として生まれますか？<br><small>（あとからエディタで変えられます）</small></p>', [
    { label: '🌿 草食 — 植物を食べるおだやかな細胞', onClick: () => start('herb') },
    { label: '🥩 肉食 — 他の細胞を食べる狩人', onClick: () => start('carn') },
  ]);
  function start(diet) {
    clearSave();
    const s = (game.save = newSave());
    s.diet = diet;
    s.cellDesign = starterCell(diet);
    s.unlocked = [...START_PARTS.cell];
    game.startStage('cell');
  }
}

function resume() {
  const s = game.save;
  if (s.stage === 'done') { game.go('ending'); return; }
  ensureFor(s.stage);
  game.go(s.stage);
}

// Fill in anything a stage needs when jumping straight to it.
function ensureFor(stage) {
  const s = game.save;
  const idx = STAGES.indexOf(stage);
  if (!s.cellDesign) s.cellDesign = starterCell(s.diet || 'herb');
  if (!s.unlocked.length) s.unlocked = [...START_PARTS.cell];
  if (idx >= 1) {
    if (!s.creatureDesign) s.creatureDesign = cellToCreature(s.cellDesign);
    for (const p of [...START_PARTS.creature, 'throat']) if (!s.unlocked.includes(p)) s.unlocked.push(p);
    s.traits.cell = s.traits.cell || computeStats(s.cellDesign).diet;
  }
  if (idx >= 2) s.traits.creature = s.traits.creature || 'mixed';
  if (idx >= 3) s.traits.tribe = s.traits.tribe || 'mixed';
  if (idx >= 4) s.traits.civ = s.traits.civ || 'mixed';
}

// ---------------------------------------------------------------- stage card

const CARD = {
  cell: { icon: '🦠', sub: '原始のスープ', text: '隕石に乗ってやってきた生命のかけら。小さな細胞として、食べて、逃げて、大きくなろう。' },
  creature: { icon: '🦎', sub: '陸へ', text: '海からあがった生き物は、島で他の種族と出会う。仲良くなるか、狩るか——それが種の未来を決める。' },
  tribe: { icon: '🔥', sub: '知性のめざめ', text: '道具と火を手にした仲間たち。村を大きくし、近くの部族とともに生きる道を探そう。' },
  civ: { icon: '🏙', sub: '国のはじまり', text: '部族は都市となり、国となった。戦争か、信仰か、経済か。惑星をひとつにまとめよう。' },
  space: { icon: '🚀', sub: '星の海へ', text: '宇宙船が完成した。銀河には無数の星と、他の文明が待っている。目指すは銀河の中心！' },
};

class CardScene {
  constructor(o) { this.stage = o.stage; this.t = 0; }
  enter() {
    ensureFor(this.stage);
    const c = CARD[this.stage];
    const box = ui.el('div', 'stage-card');
    const n = STAGES.indexOf(this.stage) + 1;
    ui.el('div', 'card-num', box, `STAGE ${n} / 5`);
    ui.el('div', 'card-icon', box, c.icon);
    ui.el('h1', '', box, STAGE_NAMES[this.stage]);
    ui.el('h2', '', box, c.sub);
    ui.el('p', '', box, c.text);
    const prev = STAGES[n - 2];
    const tr = prev && game.save.traits[prev];
    if (tr && TRAITS[prev]?.[tr]) ui.el('p', 'trait', box, `前の段階で得た特性: <b>${TRAITS[prev][tr].name}</b><br><small>${TRAITS[prev][tr].desc}</small>`);
    ui.button('はじめる', 'primary big', () => { sfx.level(); game.go(this.stage); }, box);
  }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const w = game.w, h = game.h;
    const cols = { cell: ['#0f4a63', '#03141f'], creature: ['#4c6b2f', '#10180a'], tribe: ['#7a4a1f', '#1a0d05'], civ: ['#3a4f7a', '#0b1020'], space: ['#2a1a4f', '#020208'] }[this.stage];
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, cols[0]); g.addColorStop(1, cols[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const d = game.save[this.stage === 'cell' ? 'cellDesign' : 'creatureDesign'];
    if (d) {
      ctx.globalAlpha = 0.25;
      drawCreature(ctx, d, w / 2, h / 2, this.t * 0.2 - Math.PI / 2, Math.min(w, h) / 90, { phase: this.t * 3, move: 0.5, shadow: false });
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------- cell -> land

class CellOutro {
  constructor() { this.t = 0; }
  enter() {
    const s = game.save;
    for (const p of [...START_PARTS.creature, 'throat']) if (!s.unlocked.includes(p)) s.unlocked.push(p);
    const box = ui.el('div', 'stage-card');
    ui.el('h1', '', box, '陸へ！');
    ui.el('p', '', box, `${s.cellDesign.name}は脳と足を手に入れ、陸にあがろうとしている。<br>最初のクリーチャーの姿をデザインしよう。`);
    ui.el('p', 'trait', box, `細胞期の特性: <b>${TRAITS.cell[s.traits.cell].name}</b><br><small>${TRAITS.cell[s.traits.cell].desc}</small>`);
    ui.button('クリーチャーエディタへ', 'primary big', () => {
      const s = game.save;
      s.dna += 60;
      game.go('editor', {
        kind: 'creature', design: cellToCreature(s.cellDesign), dna: s.dna, unlocked: s.unlocked,
        title: 'はじめてのクリーチャー', doneLabel: 'これで陸へ！',
        onDone: (d, dna) => { s.creatureDesign = d; s.dna = dna; game.startStage('creature'); },
      });
    }, box);
  }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const w = game.w, h = game.h;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#8fd0ff'); g.addColorStop(0.55, '#e8d9a8'); g.addColorStop(0.56, '#1d6a8a'); g.addColorStop(1, '#062030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const d = game.save.cellDesign;
    const y = h * 0.75 - Math.min(1, this.t / 3) * h * 0.2;
    drawCreature(ctx, d, w / 2, y, -Math.PI / 2, 3, { phase: this.t * 4, move: 1 });
  }
}

// ---------------------------------------------------------------- ending

class EndingScene {
  constructor() { this.t = 0; this.stars = Array.from({ length: 200 }, () => ({ a: rng() * TAU, r: rng() * 1, s: rng.range(0.5, 2) })); }
  enter() {
    const s = game.save;
    const tr = s.traits;
    const vals = ['creature', 'tribe', 'civ'].map((k) => tr[k]);
    const soc = vals.filter((v) => v === 'social').length, agg = vals.filter((v) => v === 'aggressive').length;
    const arch = soc >= 2 ? ['外交官', '言葉と友情で銀河をつないだ'] : agg >= 2 ? ['戦士', '力で道を切りひらいた'] : ['放浪者', 'あらゆる道を少しずつ歩いた'];
    const box = ui.el('div', 'stage-card ending');
    ui.el('div', 'card-icon', box, '🌌');
    ui.el('h1', '', box, '銀河の中心へ到達！');
    ui.el('p', '', box, `小さな細胞だった <b>${s.creatureDesign?.name || s.cellDesign?.name}</b> は、ついに銀河の中心にたどり着いた。<br>そこには、あらゆる生命のはじまりの光があった——。`);
    ui.el('p', 'trait', box, `あなたの種族のタイプ: <b>${arch[0]}</b><br><small>${arch[1]}</small>`);
    const path = STAGES.slice(0, 4).map((k) => tr[k] && TRAITS[k][tr[k]] ? `${STAGE_NAMES[k]}: ${TRAITS[k][tr[k]].name}` : '').filter(Boolean).join('<br>');
    ui.el('p', 'stats-line', box, `${path}<br><br>プレイ時間 ${Math.floor(s.stats.time / 60)}分 ・ 食べた数 ${fmt(s.stats.eaten)} ・ 倒した数 ${fmt(s.stats.kills)} ・ 友だちになった種 ${fmt(s.stats.friends)}`);
    const row = ui.el('div', 'btn-row', box);
    ui.button('もう一度、別の生命で', 'primary', () => { clearSave(); game.go('title'); }, row);
    ui.button('タイトルへ', '', () => game.go('title'), row);
    sfx.win();
  }
  update(dt) { this.t += dt; }
  draw(ctx) {
    const w = game.w, h = game.h;
    ctx.fillStyle = '#02020a'; ctx.fillRect(0, 0, w, h);
    const R = Math.max(w, h) * 0.7;
    for (const st of this.stars) {
      const a = st.a + this.t * 0.05 * (1.2 - st.r);
      const rr = st.r * R;
      ctx.fillStyle = hsl(40 + st.r * 200, 80, 80, 0.8);
      ctx.fillRect(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr * 0.6, st.s, st.s);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 260);
    g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, 260, 0, TAU); ctx.fill();
    const d = game.save.creatureDesign;
    if (d) drawCreature(ctx, d, w / 2, h / 2, -Math.PI / 2 + Math.sin(this.t) * 0.2, Math.min(w, h) / 160, { phase: this.t * 3, act: (Math.sin(this.t * 2) + 1) / 2, shadow: false });
  }
}

// ---------------------------------------------------------------- wiring

game.factories = {
  title: () => new TitleScene(),
  card: (o) => new CardScene(o),
  editor: (o) => new EditorScene(o),
  cell: () => new CellScene(),
  cellOutro: () => new CellOutro(),
  creature: () => new CreatureScene(),
  tribe: () => new TribeScene(),
  civ: () => new CivScene(),
  space: () => new SpaceScene(),
  ending: () => new EndingScene(),
};

// ?stage=tribe jumps straight to a stage (handy for testing).
const q = new URLSearchParams(location.search).get('stage');
if (q && (STAGES.includes(q) || q === 'ending')) {
  game.save = loadSave() || newSave();
  if (!game.save.cellDesign) { game.save.cellDesign = starterCell('herb'); game.save.unlocked = [...START_PARTS.cell]; }
  if (q === 'ending') { ensureFor('space'); game.go('ending'); }
  else { ensureFor(q); if (!game.save.reached.includes(q)) game.save.reached.push(q); game.go(q); }
} else {
  game.go('title');
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.time += dt;
  const ctx = game.ctx;
  try {
    game.scene.update(dt);
    ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
    game.scene.draw(ctx);
  } catch (e) {
    console.error(e);
  }
  game.input.endFrame();
  if (game.save && (game.saveT = (game.saveT || 0) + dt) > 10) { game.saveT = 0; game.persist(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.evo = game;
