// Sale truth check: does a listing's "50%OFF" match what its own price
// history says? And which shopping events are on today?
//
// The comparison is against the item's median price over the observed
// window (same shipping terms), never against a "list price" the shop
// writes itself.

export function saleCheck(item) {
  const claimed = item.claimed;
  if (!claimed) return null;
  const ps = item.priceStats || {};
  const base = {
    claimed_pct: claimed.pct ?? null,
    claimed_yen: claimed.yen ?? null,
    claimed_up_to: Boolean(claimed.upTo),
  };
  if (claimed.coupon) return { ...base, verdict: 'coupon', actual_drop_pct: null };
  if (!ps.median90 || ps.verdict === 'insufficient_data') return { ...base, verdict: 'unverified', actual_drop_pct: null };
  const drop = 1 - item.price / ps.median90;
  const dropPct = Math.round(drop * 1000) / 10;
  const claimedPct = claimed.pct ?? (claimed.yen ? (claimed.yen / (item.price + claimed.yen)) * 100 : 0);
  let verdict;
  // "Up to 50% off" promises less than "50% off"; judge it more leniently.
  const needed = claimed.upTo ? 0.25 : 0.5;
  if (drop >= 0.05 && dropPct >= claimedPct * needed) verdict = 'genuine';
  else if (drop >= 0.03) verdict = 'smaller_than_claimed';
  else verdict = 'not_lower_than_usual';
  return { ...base, verdict, actual_drop_pct: dropPct };
}

// Recurring point campaigns are calendar rules (they add points, not lower
// prices). Big sales have no fixed dates, so they are detected from how many
// listings mention them, or set by hand in MANUAL_EVENTS.
const RECURRING = [
  { id: 'rakuten-5-0', store: 'rakuten', kind: 'points', test: (d) => d % 5 === 0 },
  { id: 'yahoo-5', store: 'yahoo', kind: 'points', test: (d) => d % 10 === 5 },
];

const DETECTED = [
  { id: 'rakuten-super-sale', store: 'rakuten', kind: 'sale', pattern: /スーパー\s*(?:SALE|セール)/i },
  { id: 'rakuten-marathon', store: 'rakuten', kind: 'sale', pattern: /お買い物マラソン|買いまわり|買い回り/ },
  { id: 'black-friday', store: 'any', kind: 'sale', pattern: /ブラック\s*フライデー|BLACK\s*FRIDAY/i },
];

// { id, store, kind: 'sale', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } entries
// can be added when an event is announced.
export const MANUAL_EVENTS = [];

// Share of listings that must mention an event before we call it running.
const DETECT_SHARE = 0.08;

export function activeEvents(date, names, manual = MANUAL_EVENTS) {
  const day = Number(date.slice(8, 10));
  const out = RECURRING.filter((e) => e.test(day)).map(({ test, ...e }) => e);
  for (const e of DETECTED) {
    const hits = names.filter((n) => e.pattern.test(n)).length;
    if (names.length && hits / names.length >= DETECT_SHARE) out.push({ id: e.id, store: e.store, kind: e.kind, detected_share: Math.round((hits / names.length) * 100) / 100 });
  }
  for (const e of manual) if (date >= e.from && date <= e.to && !out.some((x) => x.id === e.id)) out.push(e);
  return out;
}

export const SALE_VERDICTS = ['genuine', 'smaller_than_claimed', 'not_lower_than_usual', 'coupon', 'unverified'];
