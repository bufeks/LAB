// Total quantity in a listing title, for price-per-unit comparisons.
//
//   "コシヒカリ 10kg (5kg×2袋)"        -> 10000 g
//   "天然水 2L×9本"                    -> 18000 ml
//   "トイレットペーパー 12ロール 50m ダブル" -> 1200 m single-ply equivalent
//   "単3形 アルカリ乾電池 40本"          -> 40 pieces
//
// Anything ambiguous returns null: a wrong unit price is worse than none,
// because "cheapest per kg" is exactly the claim an agent will repeat.

import { normalize } from './rank.mjs';

const MASS = { kg: 1000, キロ: 1000, キログラム: 1000, g: 1, グラム: 1 };
const VOLUME = { l: 1000, ℓ: 1000, リットル: 1000, ml: 1, ミリリットル: 1 };
// Inner packs ("24本", "6本入り") and outer packs ("2ケース", "2箱") are both
// multipliers; every count in the title must be accounted for, because a
// dropped "×2ケース" halves the quantity and doubles the unit price.
const INNER = '(?:本|袋|個|缶|パック)(?:入り?)?|入り?';
const OUTER = '(?:ケース|箱|セット|パック)(?:入り?)?';
const ANYPACK = `(?:${OUTER}|${INNER})`;

const num = (s) => Number(String(s).replace(/,/g, ''));
const distinct = (xs) => [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))];
const blank = (t, m) => t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);

function prep(title) {
  return normalize(title)
    .replace(/【[^】]*】|\[[^\]]*\]/g, (m) => ` ${m.slice(1, -1)} `) // keep bracketed quantities, drop brackets
    .replace(/[×xX＊*]/g, '×')
    .toLowerCase();
}

// Counts left in `t` (after the size chains were removed): inner and outer
// pack counts, each a product when chained ("9本×2箱" -> 18).
function packCounts(t) {
  const inner = [];
  const outer = [];
  for (const m of t.matchAll(new RegExp(`(?<![\\d.×])(\\d+)\\s*(${ANYPACK})((?:\\s*×\\s*\\d+\\s*(?:${ANYPACK})?)*)(?![a-z])`, 'g'))) {
    const n = num(m[1]) * [...m[3].matchAll(/×\s*(\d+)/g)].reduce((p, x) => p * num(x[1]), 1);
    if (n < 2) continue;
    (new RegExp(`^(?:${OUTER})$`).test(m[2]) && !m[3] ? outer : inner).push(n);
  }
  return { inner: distinct(inner), outer: distinct(outer) };
}

// Sizes with a per-unit table (mass or volume). Returns the total in base
// units, or null when the title does not pin it down.
function sized(title, table) {
  let t = title;
  const unit = Object.keys(table).sort((a, b) => b.length - a.length).join('|');
  const size = `(\\d+(?:[.,]\\d+)?)\\s*(${unit})(?![a-z])`;
  const multiplied = [];
  // "500ml×24本入×2ケース": follow the chain of multipliers.
  for (const m of [...t.matchAll(new RegExp(`${size}((?:\\s*×\\s*\\d+\\s*(?:${ANYPACK})?)+)`, 'g'))]) {
    multiplied.push(num(m[1]) * table[m[2]] * [...m[3].matchAll(/×\s*(\d+)/g)].reduce((p, x) => p * num(x[1]), 1));
    t = blank(t, m);
  }
  // "24本×500ml"
  for (const m of [...t.matchAll(new RegExp(`(\\d+)\\s*(?:${ANYPACK})?\\s*×\\s*${size}`, 'g'))]) {
    multiplied.push(num(m[2]) * table[m[3]] * num(m[1]));
    t = blank(t, m);
  }
  const plainMatches = [...t.matchAll(new RegExp(size, 'g'))];
  const plain = distinct(plainMatches.map((m) => num(m[1]) * table[m[2]]));
  for (const m of plainMatches) t = blank(t, m);
  const { inner, outer } = packCounts(t);
  if (inner.length > 1 || outer.length > 1) return null;

  if (multiplied.length) {
    const m = distinct(multiplied);
    // "10kg (5kg×2袋)": the stated total agrees with the multiplication.
    if (m.length !== 1) return null;
    // A leftover outer count ("2L×9本 2箱") multiplies the chain; a
    // leftover inner count just restates it.
    return m[0] * (outer[0] || 1);
  }
  if (plain.length === 1) return plain[0] * (inner[0] || 1) * (outer[0] || 1);
  // Several plain sizes: take the largest only when every other size
  // divides it and the title says it is a total.
  if (plain.length > 1 && !inner.length && !outer.length) {
    const max = Math.max(...plain);
    return plain.every((x) => max % x === 0) && /計|合計|total|トータル/.test(title) ? max : null;
  }
  return null;
}

export function parseQuantity(title, kind) {
  const t = prep(title);
  if (kind === 'mass') return sized(t, MASS);
  if (kind === 'volume') return sized(t, VOLUME);
  if (kind === 'count') {
    let rest = t;
    const multiplied = [];
    for (const m of [...t.matchAll(/(\d+)\s*(?:本|個)\s*(?:入り?|パック)?((?:\s*×\s*\d+\s*(?:パック|セット|箱|ケース)?)+)/g)]) {
      multiplied.push(num(m[1]) * [...m[2].matchAll(/×\s*(\d+)/g)].reduce((p, x) => p * num(x[1]), 1));
      rest = blank(rest, m);
    }
    const plainMatches = [...rest.matchAll(/(?<![\d.単])(\d+)\s*(?:本|個)(?:入り?|パック|セット)?(?![a-z])/g)];
    const plain = distinct(plainMatches.map((m) => num(m[1])));
    for (const m of plainMatches) rest = blank(rest, m);
    const outer = distinct([...rest.matchAll(/(?<![\d.×])(\d+)\s*(?:パック|セット|箱|ケース)/g)].map((m) => num(m[1])).filter((n) => n >= 2));
    if (outer.length > 1) return null;
    const m = distinct(multiplied);
    if (m.length > 1) return null;
    if (m.length) return m[0] * (outer[0] || 1);
    // "40本 (20本×2)" is caught above; two different plain counts are ambiguous.
    return plain.length === 1 ? plain[0] * (outer[0] || 1) : null;
  }
  if (kind === 'paper') {
    // Single-ply equivalent metres: rolls × metres per roll × plies.
    let rest = t;
    const mul = [...t.matchAll(/(\d+)\s*ロール((?:\s*×\s*\d+\s*(?:パック|セット|ケース|箱)?)+)/g)];
    const rollsMul = mul.map((m) => num(m[1]) * [...m[2].matchAll(/×\s*(\d+)/g)].reduce((p, x) => p * num(x[1]), 1));
    for (const m of mul) rest = blank(rest, m);
    const rollsPlain = [...rest.matchAll(/(\d+)\s*ロール/g)];
    for (const m of rollsPlain) rest = blank(rest, m);
    // "12ロール 8パック", "12ロール 2セット": packs of the stated rolls.
    const outer = distinct([...rest.matchAll(/(?<![\d.×])(\d+)\s*(?:パック|セット|ケース|箱)/g)].map((m) => num(m[1])).filter((n) => n >= 2));
    if (outer.length > 1) return null;
    const rolls = (rollsMul.length ? distinct(rollsMul) : distinct(rollsPlain.map((m) => num(m[1])))).map((r) => r * (outer[0] || 1));
    const metres = distinct([...t.matchAll(/(\d+(?:\.\d+)?)\s*m(?![lm]|m)(?![a-z])/g)].map((m) => num(m[1])).filter((m) => m >= 15 && m <= 300));
    const double = /ダブル|2枚重ね/.test(t);
    const single = /シングル/.test(t);
    if (rolls.length !== 1 || metres.length !== 1 || double === single) return null;
    return rolls[0] * metres[0] * (double ? 2 : 1);
  }
  throw new Error(`unknown quantity kind ${kind}`);
}

// Price per `per` base units, or quantity per ¥10,000 when `perYen` (used
// for furusato nozei, where the price is the donation).
export function unitValue(item, spec) {
  const q = parseQuantity(item.name, spec.kind);
  if (!q || q <= 0) return null;
  if (spec.min && q < spec.min) return null;
  if (spec.max && q > spec.max) return null;
  if (spec.perYen) return { quantity: q, value: Math.round(((q / spec.per) * spec.perYen) / item.price * 100) / 100 };
  return { quantity: q, value: Math.round((item.price / (q / spec.per)) * 10) / 10 };
}
