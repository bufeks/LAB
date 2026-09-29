import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPrices, priceStats, verdictLabel, weeklySeries } from '../history.mjs';

function series(prices, end = '2026-09-30', ship = 1) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return {
    name: 'x',
    points: prices.map((p, i) => [new Date(endMs - (prices.length - 1 - i) * 86400000).toISOString().slice(0, 10), p, ship]),
  };
}
const D = '2026-09-30';

test('fewer than 7 days is insufficient data', () => {
  assert.equal(priceStats(series([100, 100, 90]), 90, D).verdict, 'insufficient_data');
});

test('a flat price is usual, and a tiny dip is not the lowest', () => {
  assert.equal(priceStats(series(Array(20).fill(1000)), 1000, D).verdict, 'usual');
  assert.equal(priceStats(series([...Array(7).fill(5000), 4990]), 4990, D).verdict, 'usual');
});

test('verdicts against the median', () => {
  const base = Array(20).fill(1000);
  assert.equal(priceStats(series([...base, 800]), 800, D).verdict, 'lowest_observed');
  assert.equal(priceStats(series([700, ...base, 880]), 880, D).verdict, 'below_usual');
  assert.equal(priceStats(series([...base, 1150]), 1150, D).verdict, 'above_usual');
  assert.equal(priceStats(series([...base, 300]), 300, D).suspicious, true);
});

test('the lowest label names the days actually observed', () => {
  const short = priceStats(series([...Array(20).fill(1000), 800]), 800, D);
  assert.equal(short.windowDays, 21);
  assert.equal(verdictLabel(short), '観測21日の最安値');
  const long = priceStats(series([...Array(95).fill(1000), 800]), 800, D);
  assert.equal(verdictLabel(long), '90日最安値');
});

test('points with different shipping terms are not compared', () => {
  const h = series(Array(20).fill(1000), D, 1);
  // Today: 800 but shipping now extra. Only the one like-for-like point counts.
  h.points.push([D, 800, 0]);
  assert.equal(priceStats(h, 800, D, false).verdict, 'insufficient_data');
  assert.equal(priceStats(h, 1000, D, true).verdict, 'usual');
});

test('points older than 90 days do not count', () => {
  const old = series([...Array(100).fill(500), ...Array(90).fill(1000)]);
  const s = priceStats(old, 1000, D);
  assert.equal(s.min90, 1000);
  assert.equal(s.firstSeen, old.points[0][0]);
});

test('recording keeps one point per day (the lowest) and forgets long-gone items', () => {
  const h = { gone: series([100], '2026-01-01') };
  recordPrices(h, [{ id: 'a', name: 'A', price: 500, shippingIncluded: true }], D);
  recordPrices(h, [{ id: 'a', name: 'A', price: 450, shippingIncluded: true }], D);
  recordPrices(h, [{ id: 'a', name: 'A', price: 480, shippingIncluded: false }], '2026-10-01');
  assert.deepEqual(h.a.points, [[D, 450, 1], ['2026-10-01', 480, 0]]);
  assert.equal(h.gone, undefined);
});

test('weekly series keeps the lowest point of each week, oldest first', () => {
  const w = weeklySeries(series([900, 1000, 1000, 1000, 1000, 1000, 1000, 800, 1000]), D);
  assert.deepEqual(w.map(([, p]) => p), [900, 800]);
});
