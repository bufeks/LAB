import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPrices, priceStats } from '../history.mjs';

function series(prices, end = '2026-09-30') {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return { name: 'x', points: prices.map((p, i) => [new Date(endMs - (prices.length - 1 - i) * 86400000).toISOString().slice(0, 10), p]) };
}

test('fewer than 7 days is insufficient data', () => {
  assert.equal(priceStats(series([100, 100, 90]), 90, '2026-09-30').verdict, 'insufficient_data');
});

test('a flat price is usual, not the 90-day low', () => {
  assert.equal(priceStats(series(Array(20).fill(1000)), 1000, '2026-09-30').verdict, 'usual');
});

test('verdicts against the 90-day median', () => {
  const base = Array(20).fill(1000);
  assert.equal(priceStats(series([...base, 800]), 800, '2026-09-30').verdict, 'lowest_90d');
  assert.equal(priceStats(series([700, ...base, 880]), 880, '2026-09-30').verdict, 'below_usual');
  assert.equal(priceStats(series([...base, 1150]), 1150, '2026-09-30').verdict, 'above_usual');
  const s = priceStats(series([...base, 300]), 300, '2026-09-30');
  assert.equal(s.suspicious, true);
});

test('points older than 90 days do not count toward the verdict', () => {
  const old = series([...Array(100).fill(500), ...Array(90).fill(1000)]);
  const s = priceStats(old, 1000, '2026-09-30');
  assert.equal(s.min90, 1000);
  assert.equal(s.firstSeen, old.points[0][0]);
});

test('recording keeps one point per day (the lowest) and forgets long-gone items', () => {
  const h = { gone: series([100], '2026-01-01') };
  recordPrices(h, [{ id: 'a', name: 'A', price: 500 }], '2026-09-30');
  recordPrices(h, [{ id: 'a', name: 'A', price: 450 }], '2026-09-30');
  recordPrices(h, [{ id: 'a', name: 'A', price: 480 }], '2026-10-01');
  assert.deepEqual(h.a.points, [['2026-09-30', 450], ['2026-10-01', 480]]);
  assert.equal(h.gone, undefined);
});
