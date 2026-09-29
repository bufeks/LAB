import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../categories.mjs';
import { rankCategory, rejectReason, extractFacets, cleanTitle, similarity, bayesScore, choosePicks } from '../rank.mjs';

const cat = (id) => CATEGORIES.find((c) => c.id === id);
const item = (over) => ({
  id: `t:${Math.random()}`,
  name: 'モバイルバッテリー 10000mAh',
  caption: '',
  shop: 's',
  price: 3000,
  rating: 4.5,
  reviews: 100,
  available: true,
  buyUrl: 'https://example.com',
  ...over,
});

test('accessories and refills are rejected, the product itself is kept', () => {
  const mb = cat('mobile-battery');
  assert.equal(rejectReason(item({ name: 'モバイルバッテリー 収納ケースのみ' }), mb), 'excluded_accessory');
  assert.equal(rejectReason(item({ name: 'モバイルバッテリー 10000mAh 収納ケース付き' }), mb), null);
  assert.equal(rejectReason(item({ name: 'USB充電器 20W' }), mb), 'not_the_product');
  const tb = cat('electric-toothbrush');
  assert.equal(rejectReason(item({ name: '替えブラシ 4本入 電動歯ブラシ用' }), tb), 'excluded_accessory');
  assert.equal(rejectReason(item({ name: '電動歯ブラシ 音波 替えブラシ2本付き' }), tb), null);
  assert.equal(rejectReason(item({ name: '電動歯ブラシ用 交換ブラシ 8本セット' }), tb), 'excluded_accessory');
});

test('price range, review floor and availability are enforced', () => {
  const mb = cat('mobile-battery');
  assert.equal(rejectReason(item({ price: 500 }), mb), 'below_price_range');
  assert.equal(rejectReason(item({ reviews: 3 }), mb), 'too_few_reviews');
  assert.equal(rejectReason(item({ available: false }), mb), 'unavailable');
});

test('facets parse numbers with commas and full-width digits, and ignore Wh as W', () => {
  const mb = cat('mobile-battery');
  const f = extractFacets(item({ name: 'モバイルバッテリー 20,000mAh ７４Wh 最大65W出力 PSE認証' }), mb);
  assert.equal(f.capacity_mah, 20000);
  assert.equal(f.output_w, 65);
  assert.equal(f.pse, true);
  assert.equal(f.energy_wh_est, 74);
  assert.equal(f.magnetic, false);
});

test('facets outside plausible bounds are dropped', () => {
  const k = cat('electric-kettle');
  const f = extractFacets(item({ name: '電気ケトル 1.0L 1250W 型番 KT-9999W' }), k);
  assert.equal(f.capacity_l, 1);
  assert.equal(f.watt, 1250);
});

test('cleanTitle strips promo noise', () => {
  assert.equal(cleanTitle('【楽天1位】【P10倍】 電気ケトル 1.0L 送料無料 あす楽'), '電気ケトル 1.0L');
});

test('bayes score prefers many good reviews over a few perfect ones', () => {
  assert.ok(bayesScore(4.4, 3000, 4.2) > bayesScore(5.0, 3, 4.2));
});

test('near-duplicate listings collapse and keep the other offers', () => {
  const k = cat('electric-kettle');
  const { items, stats } = rankCategory(
    [
      item({ id: 'a', name: '【P10倍】電気ケトル ステンレス 1.0L 転倒湯もれ防止 KT-100', price: 4000, reviews: 900 }),
      item({ id: 'b', name: '電気ケトル ステンレス 1.0L 転倒湯もれ防止 KT-100 送料無料', price: 3800, reviews: 200 }),
      item({ id: 'c', name: '電気ケトル 温度調節 0.8L ドリップ', price: 6000, reviews: 500 }),
    ],
    k,
  );
  assert.equal(items.length, 2);
  assert.equal(stats.rejected.duplicate, 1);
  const kt = items.find((x) => x.id === 'a');
  assert.deepEqual(kt.otherOffers.map((o) => o.id), ['b']);
  assert.ok(similarity('電気ケトル 1.0L KT-100', '【送料無料】電気ケトル 1.0L KT-100') > 0.8);
});

test('picks: best, cheapest among the top 40%, and deal only with enough history', () => {
  const items = [
    { id: 'a', score: 4.6, price: 5000, priceStats: { points: 30, median90: 5000 } },
    { id: 'b', score: 4.5, price: 3000, priceStats: { points: 30, median90: 3000 } },
    { id: 'c', score: 4.4, price: 4000, priceStats: { points: 30, median90: 5000 } },
    { id: 'd', score: 4.0, price: 1000, priceStats: { points: 3, median90: 3000 } },
    { id: 'e', score: 3.9, price: 900, priceStats: { points: 30, median90: 3000, suspicious: true } },
  ];
  assert.deepEqual(choosePicks(items), { best: 'a', budget: 'b', deal: 'c' });
});
