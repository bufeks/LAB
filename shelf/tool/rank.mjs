// Turns a raw candidate pool into the ranked list SHELF publishes. Pure
// functions only, so every rule here is covered by tests.

import { unitValue } from './units.mjs';

export const PRIOR_WEIGHT = 50;
const DUPLICATE_SIMILARITY = 0.8;

// NFKC folds full-width ASCII and half-width katakana (ﾓﾊﾞｲﾙ -> モバイル),
// both common in Rakuten titles.
export const normalize = (s) => String(s ?? '').normalize('NFKC');

// Promo phrases shops wedge into titles. Each pattern removes only the phrase
// itself: Japanese titles often have no spaces, so "up to the next space"
// would eat the product name.
const PROMO = [
  /【[^】]*】|\[[^\]]*\]|《[^》]*》|≪[^≫]*≫|＼[^／]*／|\\[^/]*\//g,
  /(?:最大)?\d+(?:円|%)\s*OFF/gi,
  /(?:ポイント|P)\s*\d+\s*倍/gi,
  /クーポン(?:利用|配布中|配布|で|あり)?/g,
  /楽天(?:ランキング)?\d+位(?:獲得|受賞)?|楽天ランキング(?:入賞|受賞|獲得)?/g,
  /レビュー(?:特典|キャンペーン|で[^\s]{0,6}(?:プレゼント|進呈))/g,
  /送料無料|あす楽|即納|翌日配送|正規品|公式/g,
];

export function cleanTitle(name) {
  let t = normalize(name);
  for (const re of PROMO) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// Titles advertising a choice ("10000mAh/20000mAh 選べる") describe several
// products under one price, so their numbers and price moves are unreliable.
export function hasVariants(name) {
  const t = normalize(name);
  return /選べる|サイズ選択|容量選択|選択可/.test(t) || /\d(?:\.\d+)?\s*(?:L|mAh|W|畳|ml)\s*[\/・|]\s*\d/i.test(t);
}

// Discount the listing claims in its title ("50%OFF", "半額", "2,000円OFF"),
// read before cleanTitle strips it. Used to check sale claims against the
// price history: { pct } or { yen }, or null.
// A coupon is applied at checkout, so the listed price does not include it:
// it is not a price cut. Coupon phrases are cut out first and the rest of the
// title is read for real price-cut claims; `coupon: true` means the coupon is
// the only claim ("半額クーポン"), `withCoupon` that there is one besides a
// price cut ("30%OFF 10%OFFクーポン").
const COUPON = /(?:最大)?\s*(?:\d{1,2}\s*[%％]|\d{1,3}(?:,\d{3})*\s*円|半額)\s*(?:OFF|オフ|引き|割引)?\s*クーポン|クーポン.{0,6}?(?:\d{1,2}\s*[%％]|\d{1,3}(?:,\d{3})*\s*円|半額)\s*(?:OFF|オフ|引き)?/gi;

function priceClaim(t) {
  if (/半額/.test(t)) return { pct: 50 };
  const pcts = [...t.matchAll(/(?:最大)?\s*(\d{1,2})\s*[%％]\s*(?:OFF|オフ|引き|割引)/gi)].map((m) => Number(m[1])).filter((n) => n >= 5 && n <= 90);
  if (pcts.length) return { pct: Math.max(...pcts), upTo: /最大/.test(t) };
  const yen = [...t.matchAll(/(\d{1,3}(?:,\d{3})*|\d+)\s*円\s*(?:OFF|オフ|引き)/gi)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => n >= 100);
  if (yen.length) return { yen: Math.max(...yen) };
  return null;
}

export function claimedDiscount(name) {
  const t = normalize(name);
  const coupons = t.match(COUPON) || [];
  const price = priceClaim(t.replace(COUPON, ' '));
  if (price) return { ...price, ...(coupons.length ? { withCoupon: true } : {}) };
  if (!coupons.length) return null;
  const c = priceClaim(coupons.join(' ').replace(/クーポン/g, ' OFF ')) || {};
  return { ...c, upTo: c.upTo || /最大/.test(coupons.join(' ')), coupon: true };
}

const ALLOWED_MENTION = '(?:付き|付属|付|不要|同梱|対応|モード|入り)';

export function rejectReason(item, category) {
  if (!item.available) return 'unavailable';
  if (!Number.isFinite(item.price) || item.price <= 0) return 'no_price';
  if (category.minPrice && item.price < category.minPrice) return 'below_price_range';
  if (category.maxPrice && item.price > category.maxPrice) return 'above_price_range';
  if (item.reviews < (category.minReviews ?? 0)) return 'too_few_reviews';

  const title = cleanTitle(item.name);
  // Checks on the raw title, before promo brackets such as 【ふるさと納税】 are stripped.
  const raw = normalize(item.name);
  if (category.requireRaw && !new RegExp(category.requireRaw, 'i').test(raw)) return 'not_the_product';
  for (const pattern of category.excludeRaw || []) {
    if (new RegExp(pattern, 'i').test(raw)) return 'excluded';
  }
  const noun = new RegExp(category.noun, 'i');
  const at = title.search(noun);
  if (at < 0) return 'not_the_product';
  if (category.require2 && !new RegExp(category.require2, 'i').test(title)) return 'not_the_product';
  for (const pattern of category.exclude || []) {
    if (new RegExp(pattern, 'i').test(title)) return 'excluded';
  }
  if (new RegExp(`(?:${category.noun})\\s?(?:用|専用)`, 'i').test(title)) return 'accessory';
  if (category.accessories) {
    const acc = category.accessories;
    // "交換用フィルター不要", "替えブラシ4本付き": the accessory is mentioned, not sold.
    const t = title.replace(new RegExp(`(?:${acc})[^\\s]{0,8}?${ALLOWED_MENTION}`, 'gi'), ' ');
    if (new RegExp(`(?:${acc})\\s?(?:のみ|単品|単体)`, 'i').test(t)) return 'accessory';
    const accAt = t.search(new RegExp(acc, 'i'));
    const nounAt = t.search(noun);
    if (accAt >= 0 && (nounAt < 0 || accAt < nounAt)) return 'accessory';
  }
  return null;
}

function numberValues(text, pattern, scale = 1) {
  return [...text.matchAll(new RegExp(pattern, 'gi'))]
    .map((m) => Number(m[1].replace(/,/g, '')) * scale)
    .map((v) => Math.round(v * 1000) / 1000);
}

export function extractFacets(item, category) {
  const text = normalize(`${item.name} ${item.caption || ''}`);
  const variants = hasVariants(item.name);
  const facets = {};
  for (const f of category.facets || []) {
    if (f.type === 'flag') {
      facets[f.key] = new RegExp(f.pattern, 'i').test(text);
      continue;
    }
    if (f.type === 'enum') {
      const hit = f.options.find((o) => new RegExp(o.pattern, 'i').test(text));
      if (hit) facets[f.key] = hit.value;
      continue;
    }
    const values = [f, ...(f.alt || [])]
      .flatMap((p) => numberValues(text, p.pattern, p.scale))
      .filter((v) => Number.isFinite(v) && v >= (f.min ?? -Infinity) && v <= (f.max ?? Infinity));
    if (!values.length) continue;
    // Several different values in a pick-one listing: we cannot tell which
    // one the price belongs to, so say nothing rather than guess.
    if (variants && new Set(values).size > 1) continue;
    facets[f.key] = f.pick === 'max' ? Math.max(...values) : values[0];
  }
  for (const d of category.derived || []) {
    const v = d.compute(facets);
    if (v !== undefined) facets[d.key] = v;
  }
  return facets;
}

// Model numbers such as "A1289", "KT-100", "HX3671".
export function modelNumbers(name) {
  const t = normalize(name).toUpperCase();
  const found = t.match(/\b[A-Z]{1,4}-?\d{3,5}[A-Z]{0,3}\b/g) || [];
  return new Set(found.map((m) => m.replace('-', '')).filter((m) => !/^(USB|PD|IPX?|QC|TYPE)\d/.test(m)));
}

// Character bigrams of the cleaned title, for near-duplicate detection:
// many shops list the same product under slightly different titles.
function bigrams(s) {
  const t = cleanTitle(s).toLowerCase().replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// Stated specs that differ (capacity, ply, ...) or a different pack size
// ("5kg" vs "10kg", "20本" vs "40本") mean different products, however
// similar the titles.
function specsConflict(a, b) {
  for (const [k, v] of Object.entries(a.facets || {})) {
    const w = b.facets?.[k];
    if ((typeof v === 'number' || typeof v === 'string') && typeof w === typeof v && v !== w) return true;
  }
  const qa = a.unit?.quantity;
  const qb = b.unit?.quantity;
  if (qa && qb && qa !== qb) return true;
  return false;
}

// Same product from another shop? A shared model number decides it; without
// one, near-identical titles count only when no stated number differs, so
// "10000mAh" and "20000mAh" versions of one listing stay separate.
export function sameProduct(a, b) {
  if (specsConflict(a, b)) return false;
  const ma = modelNumbers(a.name);
  const mb = modelNumbers(b.name);
  if (ma.size && mb.size) return [...ma].some((m) => mb.has(m));
  return similarity(a.name, b.name) >= DUPLICATE_SIMILARITY;
}

export function bayesScore(rating, reviews, mean, weight = PRIOR_WEIGHT) {
  return (weight * mean + reviews * rating) / (weight + reviews);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function rankCategory(rawItems, category) {
  const rejected = {};
  const seen = new Set();
  const kept = [];
  for (const item of rawItems) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const reason = rejectReason(item, category);
    if (reason) {
      rejected[reason] = (rejected[reason] || 0) + 1;
      continue;
    }
    kept.push(item);
  }

  const totalReviews = kept.reduce((s, x) => s + x.reviews, 0);
  const mean = totalReviews ? kept.reduce((s, x) => s + x.rating * x.reviews, 0) / totalReviews : 0;
  const scored = kept
    .map((x) => ({
      ...x,
      title: cleanTitle(x.name),
      variants: hasVariants(x.name),
      score: bayesScore(x.rating, x.reviews, mean),
      facets: extractFacets(x, category),
      claimed: claimedDiscount(x.name),
      ...(category.unitPrice && !hasVariants(x.name) ? { unit: unitValue(x, category.unitPrice) } : {}),
    }))
    .sort((a, b) => b.score - a.score || b.reviews - a.reviews || a.price - b.price);

  // Collapse other shops' listings of the same product onto the best-scored
  // one, keeping their prices so agents can still point at a cheaper offer.
  const unique = [];
  for (const x of scored) {
    const dup = unique.find((u) => sameProduct(u, x));
    if (!dup) {
      unique.push({ ...x, otherOffers: [] });
      continue;
    }
    rejected.duplicate = (rejected.duplicate || 0) + 1;
    dup.otherOffers.push({ id: x.id, store: x.source, shop: x.shop, price: x.price, shippingIncluded: x.shippingIncluded, buyUrl: x.buyUrl, affiliate: x.affiliate });
  }

  unique.forEach((x, i) => {
    x.rank = i + 1;
    x.score = Math.round(x.score * 1000) / 1000;
    x.otherOffers.sort((a, b) => a.price - b.price);
  });

  return {
    items: unique,
    stats: {
      candidates: rawItems.length,
      ranked: unique.length,
      rejected,
      meanRating: Math.round(mean * 100) / 100,
      priorWeight: PRIOR_WEIGHT,
    },
  };
}

const CHEAP_VERDICTS = new Set(['lowest_observed', 'below_usual']);

// Picks are computed after price history is attached (needs verdicts). Works
// on any list, so the MCP server can re-run it on a filtered subset.
export function choosePicks(items, category = {}) {
  if (!items.length) return {};
  const scores = items.map((x) => x.score).sort((a, b) => a - b);
  const cutoff = quantile(scores, 0.6);
  const best = items[0];
  const budget = items.filter((x) => x.score >= cutoff).sort((a, b) => a.price - b.price || b.score - a.score)[0];
  const deal = items
    .filter((x) => CHEAP_VERDICTS.has(x.priceStats?.verdict) && !x.priceStats.suspicious && !x.variants)
    .sort((a, b) => a.price / a.priceStats.median90 - b.price / b.priceStats.median90)[0];
  const picks = { best: best.id };
  if (budget && budget.id !== best.id) picks.budget = budget.id;
  if (deal) picks.deal = deal.id;
  // Consumables: best value per unit among well-rated, shipping-included
  // listings (a low unit price with extra shipping is not a low price).
  const spec = category.unitPrice;
  if (spec) {
    const wide = quantile(scores, 0.4);
    const eligible = items.filter((x) => x.unit && x.shippingIncluded && x.score >= wide);
    const better = spec.perYen ? (a, b) => b.unit.value - a.unit.value : (a, b) => a.unit.value - b.unit.value;
    const top = eligible.sort(better)[0];
    if (top) picks.per_unit = top.id;
  }
  return picks;
}
