// Turns a raw candidate pool into the ranked list SHELF publishes. Pure
// functions only, so every rule here is covered by tests.

export const PRIOR_WEIGHT = 50;
const DUPLICATE_SIMILARITY = 0.8;

const toHalfWidth = (s) =>
  s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');

export function cleanTitle(name) {
  return toHalfWidth(name)
    .replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］|＼[^／]*／|\\[^/]*\//g, ' ')
    .replace(/(P|ポイント)\s*\d+\s*倍|\d+%\s*OFF|クーポン[^ ]*|送料無料|楽天\d位|楽天ランキング[^ ]*|あす楽|即納|レビュー特典[^ ]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rejectReason(item, category) {
  const title = toHalfWidth(item.name);
  if (!item.available) return 'unavailable';
  if (!Number.isFinite(item.price) || item.price <= 0) return 'no_price';
  if (category.minPrice && item.price < category.minPrice) return 'below_price_range';
  if (category.maxPrice && item.price > category.maxPrice) return 'above_price_range';
  if (item.reviews < (category.minReviews ?? 0)) return 'too_few_reviews';
  if (category.require && !new RegExp(category.require, 'i').test(title)) return 'not_the_product';
  for (const pattern of category.exclude || []) {
    if (new RegExp(pattern, 'i').test(title)) return 'excluded_accessory';
  }
  return null;
}

export function extractFacets(item, category) {
  const text = toHalfWidth(`${item.name} ${item.caption || ''}`);
  const facets = {};
  for (const f of category.facets || []) {
    const re = new RegExp(f.pattern, f.type === 'flag' ? 'i' : 'gi');
    if (f.type === 'flag') {
      facets[f.key] = re.test(text);
      continue;
    }
    const values = [...text.matchAll(re)]
      .map((m) => Number(m[1].replace(/[,，]/g, '')))
      .filter((v) => Number.isFinite(v) && v >= (f.min ?? -Infinity) && v <= (f.max ?? Infinity));
    if (!values.length) continue;
    facets[f.key] = f.pick === 'max' ? Math.max(...values) : values[0];
  }
  for (const d of category.derived || []) {
    if (facets[d.from] != null) facets[d.key] = d.formula(facets[d.from]);
  }
  return facets;
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
    .map((x) => ({ ...x, title: cleanTitle(x.name), score: bayesScore(x.rating, x.reviews, mean), facets: extractFacets(x, category) }))
    .sort((a, b) => b.score - a.score || b.reviews - a.reviews || a.price - b.price);

  // Collapse near-duplicates onto the best-scored listing, but remember the
  // cheapest offer so agents can still point at the lower price.
  const unique = [];
  for (const x of scored) {
    const dup = unique.find((u) => similarity(u.name, x.name) >= DUPLICATE_SIMILARITY);
    if (!dup) {
      unique.push({ ...x, otherOffers: [] });
      continue;
    }
    rejected.duplicate = (rejected.duplicate || 0) + 1;
    dup.otherOffers.push({ id: x.id, shop: x.shop, price: x.price, buyUrl: x.buyUrl });
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

// Picks are computed after price history is attached (needs verdicts).
export function choosePicks(items) {
  if (!items.length) return {};
  const scores = items.map((x) => x.score).sort((a, b) => a - b);
  const cutoff = quantile(scores, 0.6);
  const best = items[0];
  const budget = items.filter((x) => x.score >= cutoff).sort((a, b) => a.price - b.price || b.score - a.score)[0];
  const deal = items
    .filter((x) => x.priceStats && x.priceStats.points >= 7 && !x.priceStats.suspicious && x.priceStats.median90)
    .map((x) => ({ x, drop: 1 - x.price / x.priceStats.median90 }))
    .filter((d) => d.drop >= 0.05)
    .sort((a, b) => b.drop - a.drop)[0]?.x;
  const picks = { best: best.id };
  if (budget && budget.id !== best.id) picks.budget = budget.id;
  if (deal) picks.deal = deal.id;
  return picks;
}
