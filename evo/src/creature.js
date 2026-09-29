// The species design: a spine of round segments plus attached parts.
// The same data is drawn in every stage, so the creature the player builds
// in the editor is what walks, tribes and even pilots the spaceship.

import { TAU, clamp, hsl, mulberry32 } from './util.js';

// ---------------------------------------------------------------------------
// Part catalogue. `stats` add up into the creature's abilities.
// `under` parts are drawn beneath the body (limbs, flagella, wings...).

export const PARTS = {
  // --- cell stage
  filter:    { name: 'ろ過口', stage: 'cell', mouth: true, cost: 10, stats: { herb: 1 }, desc: '植物プランクトンを食べる口（草食）' },
  jaw:       { name: 'あご', stage: 'cell', mouth: true, cost: 10, stats: { carn: 1, bite: 1 }, desc: '肉をかみちぎる（肉食）。正面の相手にかみつく' },
  proboscis: { name: '吸い口', stage: 'cell', mouth: true, cost: 25, stats: { herb: 0.7, carn: 0.7, bite: 0.4 }, desc: '何でも吸い込む（雑食）' },
  flagellum: { name: 'べん毛', stage: 'cell', under: true, cost: 12, stats: { speed: 1 }, desc: 'すばやく泳ぐ。後ろ向きにつけよう' },
  cilia:     { name: 'せん毛', stage: 'cell', under: true, cost: 12, stats: { speed: 0.5, turn: 1 }, desc: '小回りがきく' },
  spike:     { name: 'トゲ', stage: 'cell', cost: 18, stats: { spike: 1 }, desc: 'ぶつかった相手を傷つける' },
  poison:    { name: '毒腺', stage: 'cell', cost: 28, stats: { poison: 1 }, desc: '毒の雲を残す（Shiftキー）' },
  electric:  { name: '電気器官', stage: 'cell', cost: 32, stats: { shock: 1 }, desc: '周囲に電撃（Spaceキー）' },
  eye:       { name: '目', stage: 'all', cost: 5, stats: { sight: 1 }, desc: '視界が広がる' },
  // --- creature stage
  beak:      { name: 'くちばし', stage: 'creature', mouth: true, cost: 15, stats: { herb: 1, bite: 0.5 }, desc: '果物を食べる（草食）' },
  fangs:     { name: 'キバ', stage: 'creature', mouth: true, cost: 15, stats: { carn: 1, bite: 1.5 }, desc: '肉を食べる（肉食）。かみつき↑' },
  snout:     { name: '鼻づら', stage: 'creature', mouth: true, cost: 25, stats: { herb: 0.8, carn: 0.8, bite: 0.8 }, desc: '何でも食べる（雑食）' },
  leg:       { name: 'あし', stage: 'creature', under: true, cost: 12, stats: { speed: 1 }, desc: '速く走る' },
  claw:      { name: 'ツメ', stage: 'creature', under: true, cost: 20, stats: { strike: 1.2 }, desc: 'ひっかき攻撃' },
  horn:      { name: 'ツノ', stage: 'creature', cost: 20, stats: { charge: 1.2 }, desc: '突進攻撃' },
  gland:     { name: '毒袋', stage: 'creature', cost: 22, stats: { spit: 1.2 }, desc: '遠くの敵に毒をはく' },
  wing:      { name: 'つばさ', stage: 'creature', under: true, cost: 25, stats: { dance: 1, speed: 0.4 }, desc: 'ダンス↑ 少し速くなる' },
  crest:     { name: 'とさか', stage: 'creature', cost: 18, stats: { charm: 1.2 }, desc: '魅了↑' },
  throat:    { name: 'のど袋', stage: 'creature', cost: 18, stats: { sing: 1.2 }, desc: '歌う↑' },
  frill:     { name: 'えりまき', stage: 'creature', under: true, cost: 18, stats: { pose: 1.2 }, desc: 'ポーズ↑' },
  tail:      { name: 'しっぽ', stage: 'creature', under: true, cost: 15, stats: { dance: 0.5, pose: 0.5, speed: 0.2 }, desc: 'ダンス・ポーズ↑' },
  plate:     { name: 'よろい板', stage: 'creature', cost: 25, stats: { armor: 1 }, desc: '体力↑ 受けるダメージ↓' },
};

export const STAT_LABELS = {
  speed: 'すばやさ', turn: '小回り', bite: 'かみつき', spike: 'トゲ', poison: '毒', shock: '電撃',
  sight: '視覚', strike: 'ひっかき', charge: '突進', spit: '毒はき',
  sing: '歌う', dance: 'ダンス', charm: '魅了', pose: 'ポーズ', armor: 'よろい',
};

export const CELL_STATS = ['speed', 'turn', 'bite', 'spike', 'poison', 'shock', 'sight'];
export const CREATURE_STATS = ['speed', 'bite', 'strike', 'charge', 'spit', 'sing', 'dance', 'charm', 'pose', 'armor'];

export const START_PARTS = {
  cell: ['filter', 'jaw', 'flagellum', 'eye'],
  creature: ['beak', 'fangs', 'leg', 'eye'],
};

// ---------------------------------------------------------------------------

export function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }

export function isMirrored(a) { return Math.abs(Math.sin(a)) > 0.18; }

export function computeStats(d) {
  const s = { speed: 0, turn: 0, herb: 0, carn: 0, bite: 0, spike: 0, poison: 0, shock: 0, sight: 0,
    strike: 0, charge: 0, spit: 0, sing: 0, dance: 0, charm: 0, pose: 0, armor: 0 };
  for (const p of d.parts) {
    const def = PARTS[p.type];
    if (!def) continue;
    const k = 0.75 + 0.25 * (p.s || 1);
    for (const key in def.stats) s[key] += def.stats[key] * k;
  }
  for (const key in s) if (key !== 'herb' && key !== 'carn') s[key] = clamp(s[key], 0, 5);
  let mass = 0;
  for (const seg of d.spine) mass += seg.r * seg.r;
  s.mass = mass;
  s.diet = s.herb > 0 && s.carn > 0 ? 'omni' : s.carn > 0 ? 'carn' : s.herb > 0 ? 'herb' : 'none';
  return s;
}

export const DIET_LABEL = { herb: '草食', carn: '肉食', omni: '雑食', none: '口がない！' };

export function designRadius(d) {
  let m = 0;
  for (const s of d.spine) m = Math.max(m, Math.hypot(s.x, s.y) + s.r);
  return m;
}

export function designCost(d) {
  return d.parts.reduce((a, p) => a + (PARTS[p.type]?.cost || 0), 0);
}

// ---------------------------------------------------------------------------
// Starting designs and random species.

export function starterCell(diet) {
  return {
    name: 'ぷくりん', hue: diet === 'carn' ? 10 : 150, sat: 60, hue2: diet === 'carn' ? 45 : 200, pattern: 1,
    spine: [{ x: 0, y: 0, r: 16 }],
    parts: [
      { type: diet === 'carn' ? 'jaw' : 'filter', seg: 0, a: 0, s: 1 },
      { type: 'flagellum', seg: 0, a: Math.PI, s: 1 },
      { type: 'eye', seg: 0, a: 0.6, s: 1 },
    ],
  };
}

// Grow a cell into a land creature: keep its colours and name, stretch the
// body into three segments and swap the cell mouth for a land mouth.
export function cellToCreature(cell) {
  const st = computeStats(cell);
  const mouth = st.diet === 'carn' ? 'fangs' : st.diet === 'omni' ? 'snout' : 'beak';
  return {
    name: cell.name, hue: cell.hue, sat: cell.sat, hue2: cell.hue2, pattern: cell.pattern,
    spine: [{ x: 22, y: 0, r: 10 }, { x: 4, y: 0, r: 14 }, { x: -15, y: 0, r: 11 }, { x: -30, y: 0, r: 7 }],
    parts: [
      { type: mouth, seg: 0, a: 0, s: 1 },
      { type: 'eye', seg: 0, a: 0.8, s: 1 },
      { type: 'leg', seg: 1, a: 1.4, s: 1 },
      { type: 'leg', seg: 2, a: 1.7, s: 1 },
    ],
  };
}

const CELL_EXTRA = ['flagellum', 'cilia', 'spike', 'spike', 'poison', 'electric', 'eye'];
const CREATURE_EXTRA = ['claw', 'horn', 'gland', 'wing', 'crest', 'throat', 'frill', 'tail', 'plate', 'leg'];

export function randomDesign(seed, kind, diet, power = 1) {
  const r = mulberry32(seed);
  const d = {
    name: randomName(r), hue: r.int(0, 359), sat: r.int(35, 75), hue2: r.int(0, 359), pattern: r.int(0, 2),
    spine: [], parts: [],
  };
  if (kind === 'cell') {
    const n = r.chance(0.35) ? 2 : 1;
    const base = r.range(12, 18);
    if (n === 1) d.spine.push({ x: 0, y: 0, r: base });
    else { d.spine.push({ x: base * 0.5, y: 0, r: base * 0.85 }, { x: -base * 0.6, y: 0, r: base }); }
    const mouth = diet === 'carn' ? 'jaw' : diet === 'omni' ? 'proboscis' : 'filter';
    d.parts.push({ type: mouth, seg: 0, a: 0, s: r.range(0.8, 1.3) });
    d.parts.push({ type: r.chance(0.6) ? 'flagellum' : 'cilia', seg: n - 1, a: Math.PI + r.range(-0.3, 0.3), s: r.range(0.8, 1.3) });
    d.parts.push({ type: 'eye', seg: 0, a: r.range(0.4, 1.0), s: r.range(0.7, 1.3) });
    const extras = Math.min(4, Math.floor(r.range(0, 2) + power));
    for (let i = 0; i < extras; i++) {
      const t = r.pick(CELL_EXTRA);
      d.parts.push({ type: t, seg: r.int(0, n - 1), a: t === 'flagellum' ? Math.PI * r.range(0.7, 1) : r.range(0.6, 2.6), s: r.range(0.7, 1.3) });
    }
  } else {
    const n = r.int(2, 5);
    let x = 20;
    for (let i = 0; i < n; i++) {
      const rad = i === 0 ? r.range(7, 12) : i === n - 1 ? r.range(6, 10) : r.range(10, 18);
      d.spine.push({ x, y: 0, r: rad });
      x -= rad * r.range(1.0, 1.5);
    }
    const mouth = diet === 'carn' ? 'fangs' : diet === 'omni' ? 'snout' : 'beak';
    d.parts.push({ type: mouth, seg: 0, a: 0, s: r.range(0.8, 1.3) });
    d.parts.push({ type: 'eye', seg: 0, a: r.range(0.5, 1.2), s: r.range(0.7, 1.4) });
    const legSegs = n <= 2 ? [0, 1] : [1, n - 2];
    for (const seg of legSegs) d.parts.push({ type: 'leg', seg, a: r.range(1.3, 1.9), s: r.range(0.7, 1.4) });
    const extras = Math.min(5, Math.floor(r.range(1, 3) + power));
    for (let i = 0; i < extras; i++) {
      const t = r.pick(CREATURE_EXTRA);
      const seg = t === 'horn' || t === 'crest' ? 0 : t === 'tail' ? n - 1 : r.int(0, n - 1);
      const a = t === 'horn' ? r.range(0, 0.6) : t === 'tail' ? Math.PI : t === 'crest' ? Math.PI : r.range(0.8, 2.4);
      d.parts.push({ type: t, seg, a, s: r.range(0.8, 1.3) });
    }
  }
  return d;
}

const SYL = ['ぷ', 'も', 'る', 'ぴ', 'ご', 'ら', 'ぬ', 'ぽ', 'ざ', 'き', 'ぐ', 'み', 'ろ', 'べ', 'ち', 'ふ', 'ど', 'に', 'ば', 'と', 'ぎゅ', 'にゃ', 'ぴょ', 'もっ'];
export function randomName(r = Math.random) {
  const pick = () => SYL[Math.floor((r.call ? r() : Math.random()) * SYL.length)];
  const n = 2 + Math.floor((r.call ? r() : Math.random()) * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += pick();
  return s + ((r.call ? r() : Math.random()) < 0.5 ? 'ん' : 'ー');
}

// ---------------------------------------------------------------------------
// Drawing. Local frame: +x = forward, +y = right side.

export function palette(d) {
  return {
    body: hsl(d.hue, d.sat, 55),
    dark: hsl(d.hue, d.sat, 26),
    light: hsl(d.hue, d.sat, 74),
    accent: hsl(d.hue2, 70, 58),
    accentDark: hsl(d.hue2, 60, 32),
    bone: '#efe6cf',
  };
}

// Spine positions, bent by a swimming/walking wave.
function spinePose(d, phase, move) {
  const n = d.spine.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = d.spine[i];
    const w = n > 1 ? Math.sin(phase * 1.0 - i * 0.9) * move * 2.2 * (i / (n - 1)) : 0;
    out.push({ x: s.x, y: s.y + w, r: s.r });
  }
  return out;
}

export function anchorOf(pose, p, under) {
  const s = pose[Math.min(p.seg, pose.length - 1)];
  const k = under ? 0.8 : 0.92;
  return { x: s.x + Math.cos(p.a) * s.r * k, y: s.y + Math.sin(p.a) * s.r * k };
}

// anim: { phase, move (0..1), hurt (0..1), alpha, act (0..1 action pulse) }
export function drawCreature(ctx, d, x, y, rot, scale, anim = {}) {
  const phase = anim.phase || 0, move = anim.move || 0;
  const col = d._pal || (d._pal = palette(d));
  if (d._palKey !== d.hue + ':' + d.sat + ':' + d.hue2) { d._pal = palette(d); d._palKey = d.hue + ':' + d.sat + ':' + d.hue2; }
  const c = d._pal;
  const pose = spinePose(d, phase, move);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  if (anim.alpha != null) ctx.globalAlpha *= anim.alpha;

  // shadow
  if (anim.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (const s of pose) { ctx.beginPath(); ctx.arc(s.x + 3, s.y + 4, s.r * 1.02, 0, TAU); ctx.fill(); }
  }

  const drawParts = (under) => {
    d.parts.forEach((p, idx) => {
      const def = PARTS[p.type];
      if (!def || !!def.under !== under) return;
      const sides = isMirrored(p.a) ? [1, -1] : [1];
      for (const side of sides) {
        const pp = side === 1 ? p : { ...p, a: -p.a };
        const an = anchorOf(pose, pp, under);
        ctx.save();
        ctx.translate(an.x, an.y);
        ctx.rotate(pp.a);
        const sc = p.s || 1;
        ctx.scale(sc, sc * (side === -1 ? -1 : 1));
        PART_DRAW[p.type](ctx, c, { phase, move, side, idx, seg: p.seg, act: anim.act || 0, a: pp.a });
        ctx.restore();
      }
    });
  };

  drawParts(true);

  // body: outline pass then fill pass so segments merge into one blob
  ctx.fillStyle = c.dark;
  for (const s of pose) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 1.6, 0, TAU); ctx.fill(); }
  for (let i = 0; i < pose.length - 1; i++) bridge(ctx, pose[i], pose[i + 1], 1.6);
  ctx.fillStyle = c.body;
  for (const s of pose) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
  for (let i = 0; i < pose.length - 1; i++) bridge(ctx, pose[i], pose[i + 1], 0);
  // back highlight
  ctx.fillStyle = c.light;
  ctx.globalAlpha *= 0.45;
  for (const s of pose) { ctx.beginPath(); ctx.ellipse(s.x - s.r * 0.15, s.y - s.r * 0.25, s.r * 0.55, s.r * 0.3, 0, 0, TAU); ctx.fill(); }
  ctx.globalAlpha /= 0.45;

  // pattern
  if (d.pattern === 1) {
    ctx.fillStyle = c.accent;
    pose.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        const a = i * 2.1 + k * 2.4;
        const rr = s.r * (0.25 + 0.3 * ((k * 7 + i * 3) % 5) / 5);
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr, s.r * 0.16, 0, TAU);
        ctx.fill();
      }
    });
  } else if (d.pattern === 2) {
    ctx.strokeStyle = c.accent;
    ctx.lineCap = 'round';
    pose.forEach((s) => {
      ctx.lineWidth = s.r * 0.28;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - s.r * 0.72);
      ctx.lineTo(s.x, s.y + s.r * 0.72);
      ctx.stroke();
    });
  }

  drawParts(false);

  if (anim.hurt > 0) {
    ctx.fillStyle = `rgba(255,40,40,${anim.hurt * 0.55})`;
    for (const s of pose) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 1, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

function bridge(ctx, a, b, pad) {
  // Fill the waist between two neighbouring circles.
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.01) return;
  const nx = -dy / l, ny = dx / l;
  const ra = a.r * 0.8 + pad, rb = b.r * 0.8 + pad;
  ctx.beginPath();
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
  ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
  ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
  ctx.closePath();
  ctx.fill();
}

// Each part draws itself at the origin with +x pointing out of the body.
const PART_DRAW = {
  filter(ctx, c, o) {
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.ellipse(1, 0, 4, 6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = c.light; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const w = Math.sin(o.phase * 3 + i) * 1.2;
      ctx.beginPath(); ctx.moveTo(3, i * 2.2); ctx.lineTo(8 + w, i * 2.8); ctx.stroke();
    }
  },
  jaw(ctx, c, o) {
    const open = 0.35 + Math.sin(o.phase * 2.5) * 0.2 + o.act * 0.4;
    ctx.fillStyle = c.accentDark;
    for (const sg of [1, -1]) {
      ctx.save(); ctx.rotate(sg * open);
      ctx.beginPath(); ctx.moveTo(0, sg * 2); ctx.quadraticCurveTo(9, sg * 6, 13, 0); ctx.quadraticCurveTo(8, sg * 2, 2, 0); ctx.fill();
      ctx.restore();
    }
  },
  proboscis(ctx, c, o) {
    ctx.strokeStyle = c.accentDark; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, Math.sin(o.phase * 2) * 3, 12, 0); ctx.stroke();
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(12, 0, 2.6, 0, TAU); ctx.fill();
  },
  flagellum(ctx, c, o) {
    ctx.strokeStyle = c.accentDark; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      ctx.lineTo(t * 30, Math.sin(o.phase * 6 - t * 7) * 5 * t);
    }
    ctx.stroke();
  },
  cilia(ctx, c, o) {
    ctx.strokeStyle = c.accentDark; ctx.lineWidth = 1.2;
    for (let i = -3; i <= 3; i++) {
      const w = Math.sin(o.phase * 8 + i) * 0.35;
      ctx.save(); ctx.translate(0, i * 2.6); ctx.rotate(w);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.restore();
    }
  },
  spike(ctx, c) {
    ctx.fillStyle = c.bone; ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-1, -4); ctx.lineTo(14, 0); ctx.lineTo(-1, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  poison(ctx, c, o) {
    ctx.fillStyle = '#7ddc3a'; ctx.strokeStyle = '#2f5e12'; ctx.lineWidth = 1;
    const p = 1 + Math.sin(o.phase * 3) * 0.08;
    ctx.beginPath(); ctx.arc(3, 0, 5 * p, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2f5e12'; ctx.beginPath(); ctx.arc(4, -1.5, 1, 0, TAU); ctx.arc(2, 2, 1, 0, TAU); ctx.fill();
  },
  electric(ctx, c, o) {
    ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#8a6d00'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(3, 0, 5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#8a6d00'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(1, -3); ctx.lineTo(4, -0.5); ctx.lineTo(2, 0.5); ctx.lineTo(5, 3); ctx.stroke();
  },
  eye(ctx, c, o) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-1, 0, 4.2, 0, TAU); ctx.fill(); ctx.stroke();
    // look forward regardless of where the eye sits
    const la = -o.a;
    const blink = (Math.sin(o.phase * 0.7 + o.idx) > 0.985) ? 0.2 : 1;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(-1 + Math.cos(la) * 1.6, Math.sin(la) * 1.6 * (o.side || 1), 2.1, 2.1 * blink, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-1.6 + Math.cos(la) * 1.6, -0.8, 0.7, 0, TAU); ctx.fill();
  },
  beak(ctx, c, o) {
    const open = o.act * 0.3;
    ctx.fillStyle = '#f2b640'; ctx.strokeStyle = '#8a5a10'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-2, -5); ctx.lineTo(12, -open * 5); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, 5); ctx.lineTo(11, open * 5); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  fangs(ctx, c, o) {
    const open = 0.2 + o.act * 0.5;
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.ellipse(2, 0, 5, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b3223a';
    ctx.beginPath(); ctx.ellipse(3, 0, 3 + open * 3, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    for (const sg of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(4, sg * 4); ctx.lineTo(11 + open * 2, sg * (2.5 + open * 2)); ctx.lineTo(5, sg * 1.5); ctx.fill();
    }
  },
  snout(ctx, c) {
    ctx.fillStyle = c.light; ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(4, 0, 7, 5.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(8, -2, 1.2, 0, TAU); ctx.arc(8, 2, 1.2, 0, TAU); ctx.fill();
  },
  leg(ctx, c, o) {
    const swing = Math.sin(o.phase * 1.0 + (o.side === 1 ? 0 : Math.PI) + o.seg * 1.9) * 0.55 * o.move;
    ctx.rotate(swing);
    ctx.strokeStyle = c.dark; ctx.lineCap = 'round';
    ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 1); ctx.lineTo(17, -3); ctx.stroke();
    ctx.strokeStyle = c.body;
    ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 1); ctx.lineTo(17, -3); ctx.stroke();
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.ellipse(18, -4, 3.5, 2.6, -0.6, 0, TAU); ctx.fill();
  },
  claw(ctx, c, o) {
    const swing = -0.9 + Math.sin(o.phase * 1.0 + (o.side === 1 ? 1 : 1 + Math.PI)) * 0.25 * o.move - o.act * 0.9;
    ctx.rotate(swing);
    ctx.strokeStyle = c.dark; ctx.lineCap = 'round'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, 2); ctx.stroke();
    ctx.strokeStyle = c.body; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, 2); ctx.stroke();
    ctx.fillStyle = c.bone;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(13, 2 + i * 2.2); ctx.lineTo(20, i * 3.6); ctx.lineTo(13, 3 + i * 2.2); ctx.fill();
    }
  },
  horn(ctx, c) {
    ctx.fillStyle = c.bone; ctx.strokeStyle = '#8c7f60'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-2, -3.5); ctx.quadraticCurveTo(10, -4, 17, -8); ctx.quadraticCurveTo(10, 0, -2, 3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  gland(ctx, c, o) {
    ctx.fillStyle = '#9bd84a'; ctx.strokeStyle = '#3c6614'; ctx.lineWidth = 1;
    const p = 1 + Math.sin(o.phase * 2) * 0.1 + o.act * 0.3;
    ctx.beginPath(); ctx.ellipse(3, 0, 5.5 * p, 4.5 * p, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3c6614'; ctx.beginPath(); ctx.arc(7, 0, 1.3, 0, TAU); ctx.fill();
  },
  wing(ctx, c, o) {
    const flap = 0.75 + 0.25 * Math.sin(o.phase * 2.2) + o.act * 0.3;
    ctx.scale(flap, 1);
    ctx.fillStyle = c.accent; ctx.strokeStyle = c.accentDark; ctx.lineWidth = 1.2;
    ctx.globalAlpha *= 0.85;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.quadraticCurveTo(18, -16, 32, -6); ctx.quadraticCurveTo(24, 0, 30, 6);
    ctx.quadraticCurveTo(16, 4, 0, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha /= 0.85;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(30, -5); ctx.moveTo(8, 1); ctx.lineTo(26, 4); ctx.stroke();
  },
  crest(ctx, c, o) {
    ctx.fillStyle = c.accent; ctx.strokeStyle = c.accentDark; ctx.lineWidth = 1;
    const spread = 1 + o.act * 0.5;
    for (let i = -2; i <= 2; i++) {
      ctx.save(); ctx.rotate(i * 0.32 * spread);
      ctx.beginPath(); ctx.ellipse(8, 0, 9, 2.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  },
  throat(ctx, c, o) {
    const p = 1 + Math.sin(o.phase * 1.5) * 0.06 + o.act * 0.6;
    ctx.fillStyle = c.accent; ctx.strokeStyle = c.accentDark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(2, 0, 5 * p, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(0.5, -1.5 * p, 1.6 * p, 0, TAU); ctx.fill();
  },
  frill(ctx, c, o) {
    const sp = 1 + o.act * 0.4;
    ctx.fillStyle = c.accent; ctx.strokeStyle = c.accentDark; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -9 * sp);
    for (let i = 0; i <= 6; i++) {
      const t = -1 + i / 3;
      ctx.quadraticCurveTo(14 * sp, t * 9 * sp - 1.5, 12 * sp * Math.cos(t * 0.8), t * 10 * sp);
    }
    ctx.lineTo(0, 9 * sp); ctx.closePath(); ctx.fill(); ctx.stroke();
  },
  tail(ctx, c, o) {
    ctx.strokeStyle = c.dark; ctx.lineCap = 'round';
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([t * 28, Math.sin(o.phase * 1.3 - t * 3) * 6 * t * (0.4 + o.move * 0.6 + o.act)]);
    }
    for (const [w, col] of [[7, c.dark], [4.5, c.body]]) {
      ctx.strokeStyle = col;
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.lineWidth = w * (1 - i / pts.length * 0.8);
        ctx.beginPath(); ctx.moveTo(...pts[i]); ctx.lineTo(...pts[i + 1]); ctx.stroke();
      }
    }
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(...pts[8], 2.5, 0, TAU); ctx.fill();
  },
  plate(ctx, c) {
    ctx.fillStyle = c.accentDark; ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(-5, i * 5 - 3); ctx.lineTo(6, i * 5); ctx.lineTo(-5, i * 5 + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  },
};

// Icon for part buttons.
export function drawPartIcon(ctx, type, size, d) {
  const c = palette(d || { hue: 180, sat: 50, hue2: 30 });
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size * 0.3, size / 2);
  const sc = size / 34;
  ctx.scale(sc, sc);
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.arc(-6, 0, 6, 0, TAU); ctx.fill();
  PART_DRAW[type](ctx, c, { phase: 0.5, move: 0, side: 1, idx: 0, seg: 0, act: 0, a: 0 });
  ctx.restore();
}
