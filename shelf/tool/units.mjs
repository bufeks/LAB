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
const PACK = '本|袋|個|箱|缶|パック|セット|ケース入り|入';

const num = (s) => Number(String(s).replace(/,/g, ''));
const distinct = (xs) => [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))];

function prep(title) {
  return normalize(title)
    .replace(/【[^】]*】|\[[^\]]*\]/g, (m) => ` ${m.slice(1, -1)} `) // keep bracketed quantities, drop brackets
    .replace(/[×xX＊*]/g, '×')
    .toLowerCase();
}

// Sizes with a per-unit table (mass or volume). Returns totals in base units.
function sized(t, table) {
  const unit = Object.keys(table).sort((a, b) => b.length - a.length).join('|');
  const size = `(\\d+(?:[.,]\\d+)?)\\s*(${unit})(?![a-z])`;
  const out = { multiplied: [], counted: [], plain: [] };
  // "500ml×24本×2ケース": follow the chain of multipliers.
  for (const m of t.matchAll(new RegExp(`${size}\\s*×\\s*(\\d+)\\s*(?:${PACK})?(?:\\s*×\\s*(\\d+))?`, 'g'))) {
    out.multiplied.push(num(m[1]) * table[m[2]] * num(m[3]) * (m[4] ? num(m[4]) : 1));
  }
  for (const m of t.matchAll(new RegExp(`(\\d+)\\s*(?:${PACK})?\\s*×\\s*${size}`, 'g'))) out.multiplied.push(num(m[2]) * table[m[3]] * num(m[1]));
  const plain = [...t.matchAll(new RegExp(size, 'g'))].map((m) => num(m[1]) * table[m[2]]);
  out.plain = plain;
  // "2L 9本" / "500ml 24本入": one size and one pack count, not joined by ×.
  const packs = [...t.matchAll(new RegExp(`(?<![\\d.×])(\\d+)\\s*(?:${PACK})(?![a-z])`, 'g'))].map((m) => num(m[1])).filter((n) => n >= 2);
  if (distinct(plain).length === 1 && distinct(packs).length === 1 && !out.multiplied.length) out.counted.push(plain[0] * packs[0]);
  return out;
}

function decide({ multiplied, counted, plain }) {
  if (multiplied.length) {
    const m = distinct(multiplied);
    // "10kg (5kg×2袋)": the stated total agrees with the multiplication.
    if (m.length === 1) return m[0];
    return null;
  }
  if (counted.length) return counted[0];
  const p = distinct(plain);
  if (p.length === 1) return p[0];
  // "10kg 5kg×2" without ×-match handled above; several plain sizes left:
  // take the largest only when every other size divides it (sub-packs).
  if (p.length > 1) {
    const max = Math.max(...p);
    return p.every((x) => max % x === 0) && /計|合計|total|トータル/.test(plain.join('')) ? max : null;
  }
  return null;
}

export function parseQuantity(title, kind) {
  const t = prep(title);
  if (kind === 'mass') return decide(sized(t, MASS));
  if (kind === 'volume') return decide(sized(t, VOLUME));
  if (kind === 'count') {
    const multiplied = [...t.matchAll(/(\d+)\s*(?:本|個)\s*(?:入り?|パック)?\s*×\s*(\d+)/g)].map((m) => num(m[1]) * num(m[2]));
    const plain = [...t.matchAll(/(?<![\d.単])(\d+)\s*(?:本|個)(?:入り?|パック|セット)?(?![a-z])/g)].map((m) => num(m[1]));
    return decide({ multiplied, counted: [], plain });
  }
  if (kind === 'paper') {
    // Single-ply equivalent metres: rolls × metres per roll × plies.
    const rollsMul = [...t.matchAll(/(\d+)\s*ロール\s*×\s*(\d+)/g)].map((m) => num(m[1]) * num(m[2]));
    const rolls = rollsMul.length ? distinct(rollsMul) : distinct([...t.matchAll(/(\d+)\s*ロール/g)].map((m) => num(m[1])));
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
