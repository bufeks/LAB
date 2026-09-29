// Daily price history per item. This is the part of SHELF an agent cannot get
// from a single shop page: whether today's price is actually good.
//
// Stored as { [itemId]: { name, points: [[YYYY-MM-DD, price], ...] } }.

const WINDOW_DAYS = 90;
const KEEP_DAYS = 400;
const FORGET_AFTER_DAYS = 120;

const dayNumber = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

export function recordPrices(history, items, date) {
  for (const item of items) {
    const h = (history[item.id] ||= { name: item.title || item.name, points: [] });
    h.name = item.title || item.name;
    const last = h.points[h.points.length - 1];
    if (last && last[0] === date) last[1] = Math.min(last[1], item.price);
    else h.points.push([date, item.price]);
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

export function priceStats(entry, currentPrice, date) {
  const today = dayNumber(date);
  const pts = (entry?.points || []).filter(([d]) => today - dayNumber(d) < WINDOW_DAYS);
  const prices = pts.map(([, p]) => p);
  const firstSeen = entry?.points?.[0]?.[0] ?? date;
  if (prices.length < 7) {
    return { points: prices.length, firstSeen, verdict: 'insufficient_data' };
  }
  const min90 = Math.min(...prices);
  const max90 = Math.max(...prices);
  const median90 = median(prices);
  // A price far below its usual level is more often a listing error or a
  // different variant than a real deal; keep it out of "deal" picks.
  const suspicious = currentPrice < median90 * 0.4;
  let verdict = 'usual';
  // Today's price is in the window, so a flat price is always "the minimum";
  // only call it the 90-day low when it is also below the usual level.
  if (currentPrice <= min90 && currentPrice < median90) verdict = 'lowest_90d';
  else if (currentPrice <= median90 * 0.9) verdict = 'below_usual';
  else if (currentPrice >= median90 * 1.1) verdict = 'above_usual';
  return {
    points: prices.length,
    firstSeen,
    min90,
    median90: Math.round(median90),
    max90,
    verdict,
    ...(suspicious ? { suspicious: true } : {}),
  };
}

export const VERDICT_LABELS = {
  insufficient_data: '観測中（7日未満）',
  lowest_90d: '90日最安値',
  below_usual: 'いつもより安い',
  usual: 'いつもの価格',
  above_usual: 'いつもより高い',
};
