// Persisted progress (localStorage). Each stage reads what it needs and
// writes back its outcome, so the player's choices carry forward.

const KEY = 'evo-save-v1';

export const STAGES = ['cell', 'creature', 'tribe', 'civ', 'space'];
export const STAGE_NAMES = {
  cell: '細胞期', creature: 'クリーチャー期', tribe: '部族期', civ: '文明期', space: '宇宙期',
};

// Outcome of each stage -> a trait that helps later (like Spore's consequence traits).
export const TRAITS = {
  cell: {
    herb: { name: 'のんびり草食', desc: 'クリーチャー期: 体力+30%' },
    carn: { name: '獰猛な肉食', desc: 'クリーチャー期: 攻撃力+30%' },
    omni: { name: '器用な雑食', desc: 'クリーチャー期: 攻撃力と体力+15%' },
  },
  creature: {
    social: { name: '社交的', desc: '部族期: 贈り物・演奏の効果+50%' },
    aggressive: { name: '捕食者', desc: '部族期: 部族員の攻撃力+40%' },
    mixed: { name: '適応者', desc: '部族期: 部族員の体力+30%' },
  },
  tribe: {
    social: { name: '友好の民', desc: '文明期: 都市の買収価格-30%' },
    aggressive: { name: '戦士の民', desc: '文明期: 車両の攻撃力+40%' },
    mixed: { name: '調和の民', desc: '文明期: 収入+25%' },
  },
  civ: {
    social: { name: '外交帝国', desc: '宇宙期: 同盟・交易の価格-40%' },
    aggressive: { name: '軍事帝国', desc: '宇宙期: 艦の攻撃力+50%' },
    mixed: { name: '交易帝国', desc: '宇宙期: スパイス収入+40%' },
  },
};

export function newSave() {
  return {
    v: 1,
    stage: 'cell',
    reached: ['cell'],
    diet: 'herb',
    dna: 0,
    cellDesign: null,
    creatureDesign: null,
    unlocked: [],
    species: [],        // species met in creature stage: {seed, design, diet, fate}
    traits: {},         // stage -> trait key
    stats: { kills: 0, friends: 0, eaten: 0, time: 0 },
    names: {},
  };
}

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return s;
  } catch { /* fall through */ }
  return null;
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s, (k, v) => (k.startsWith('_') ? undefined : v))); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Classify a stage's play: ratio of friendly vs hostile outcomes.
export function classify(friendly, hostile) {
  if (friendly + hostile === 0) return 'mixed';
  const r = friendly / (friendly + hostile);
  return r >= 0.66 ? 'social' : r <= 0.34 ? 'aggressive' : 'mixed';
}
