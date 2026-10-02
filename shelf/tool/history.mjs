// Daily price history per item. This is the part of SHELF an agent cannot get
// from a single shop page: whether today's price is actually good.
//
// Stored as { [itemId]: { name, points: [[YYYY-MM-DD, price, shippingIncluded 1|0], ...] } }.

const WINDOW_DAYS = 90;
const KEEP_DAYS = 400;
const FORGET_AFTER_DAYS = 120;
const MIN_POINTS = 7;
const LOWEST_MIN_DROP = 0.03;

const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

export function recordPrices(history, items, date) {
  for (const item of items) {
    const h = (history[item.id] ||= { name: item.title || item.name, points: [] });
    h.name = item.title || item.name;
    const ship = item.shippingIncluded ? 1 : 0;
    const last = h.points[h.points.length - 1];
    if (last && last[0] === date) {
      if (item.price < last[1]) h.points[h.points.length - 1] = [date, item.price, ship];
    } else h.points.push([date, item.price, ship]);
  }
  const today = dayNumber(date);
  for (const [id, h] of Object.entries(history)) {
    h.points = h.points.filter(([d]) => today - dayNumber(d) <= KEEP_DAYS);
    const last = h.points[h.points.length - 1];
    if (!last || today - dayNumber(last[0]) > FORGET_AFTER_DAYS) delete history[id];
  }
  return history;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Lowest price per week, as [week end date, price], oldest first. Weeks end
// on `date`, so every item's series shares the same week boundaries (which
// the category price index relies on).
export function weeklySeries(entry, date, weeks = 13) {
  const today = dayNumber(date);
  const buckets = new Map();
  for (const [d, p] of entry?.points || []) {
    const age = today - dayNumber(d);
    if (age < 0 || age >= weeks * 7) continue;
    const w = Math.floor(age / 7);
    if (!buckets.has(w) || p < buckets.get(w)) buckets.set(w, p);
  }
  const end = (w) => new Date((today - w * 7) * 86400000).toISOString().slice(0, 10);
  return [...buckets.entries()].sort((a, b) => b[0] - a[0]).map(([w, p]) => [end(w), p]);
}

export function priceStats(entry, currentPrice, date, shippingIncluded) {
  const today = dayNumber(date);
  const ship = shippingIncluded === undefined ? undefined : shippingIncluded ? 1 : 0;
  // Only compare like with like: a price cut that moves shipping from
  // included to extra is not a price cut.
  const pts = (entry?.points || []).filter(
    ([d, , s]) => today - dayNumber(d) < WINDOW_DAYS && (ship === undefined || s === undefined || s === ship),
  );
  const prices = pts.map(([, p]) => p);
  const firstSeen = entry?.points?.[0]?.[0] ?? date;
  const windowDays = pts.length ? today - dayNumber(pts[0][0]) + 1 : 0;
  if (prices.length < MIN_POINTS) {
    return { points: prices.length, windowDays, firstSeen, verdict: 'insufficient_data' };
  }
  const min90 = Math.min(...prices);
  const max90 = Math.max(...prices);
  const median90 = median(prices);
  // A price far below its usual level is more often a listing error or a
  // different variant than a real deal; keep it out of "deal" picks.
  const suspicious = currentPrice < median90 * 0.4;
  let verdict = 'usual';
  // Today's price is in the window, so a flat price is always "the minimum";
  // only call it the lowest when it is also clearly below the usual level.
  if (currentPrice <= min90 && currentPrice <= median90 * (1 - LOWEST_MIN_DROP)) verdict = 'lowest_observed';
  else if (currentPrice <= median90 * 0.9) verdict = 'below_usual';
  else if (currentPrice >= median90 * 1.1) verdict = 'above_usual';
  return {
    points: prices.length,
    windowDays,
    firstSeen,
    min90,
    median90: Math.round(median90),
    max90,
    verdict,
    ...(suspicious ? { suspicious: true } : {}),
  };
}

export function verdictLabel(stats) {
  const v = stats?.verdict || 'insufficient_data';
  if (v === 'lowest_observed') return stats.windowDays >= WINDOW_DAYS ? '90日最安値' : `観測${stats.windowDays}日の最安値`;
  return VERDICT_LABELS[v];
}

export const VERDICT_LABELS = {
  insufficient_data: '観測中（7日未満）',
  lowest_observed: '観測期間の最安値',
  below_usual: 'いつもより安い',
  usual: 'いつもの価格',
  above_usual: 'いつもより高い',
};
