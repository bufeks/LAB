import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../categories.mjs';
import { rankCategory, rejectReason, extractFacets, cleanTitle, sameProduct, bayesScore, choosePicks, hasVariants } from '../rank.mjs';

const cat = (id) => CATEGORIES.find((c) => c.id === id);
let n = 0;
const item = (over) => ({
  id: `t:${++n}`,
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
const reject = (id, name) => rejectReason(item({ name, price: 5000 }), cat(id));

test('real products that mention accessories are kept', () => {
  for (const [id, name] of [
    ['humidifier', '加湿器 スチーム式 交換用フィルター不要 8畳'],
    ['humidifier', '加湿器 気化式 交換用フィルター1枚付き'],
    ['wireless-earphones', 'ワイヤレスイヤホン 交換用イヤーピース付属 ノイズキャンセリング'],
    ['wireless-earphones', '【イヤーピース3サイズ付属】ワイヤレスイヤホン Bluetooth5.3'],
    ['wireless-earphones', 'ワイヤレスイヤホン 有線モード対応'],
    ['electric-toothbrush', '【替えブラシ4本付き】電動歯ブラシ 音波'],
    ['electric-toothbrush', 'ソニッケアー 電動歯ブラシ HX3671 替えブラシ 2本セット'],
    ['electric-kettle', '電気ケトル 1.2L 交換用パッキン付き'],
    ['mobile-battery', 'モバイルバッテリー 10000mAh 収納ケース付き'],
    ['mobile-battery', 'ケーブル内蔵 モバイルバッテリー 10000mAh'],
    ['mobile-battery', 'ﾓﾊﾞｲﾙﾊﾞｯﾃﾘｰ 10000mAh'],
  ]) {
    assert.equal(reject(id, name), null, name);
  }
});

test('accessories, refills and spare parts are rejected', () => {
  for (const [id, name] of [
    ['electric-toothbrush', '替えブラシ 4本入 電動歯ブラシ用'],
    ['electric-toothbrush', '電動歯ブラシ用 交換ブラシ 8本セット'],
    ['wireless-earphones', 'イヤーピース ワイヤレスイヤホン用 Mサイズ'],
    ['humidifier', '交換用フィルター 加湿器 XX-100 対応'],
    ['humidifier', '加湿器用 抗菌カートリッジ'],
    ['mobile-battery', 'モバイルバッテリー 収納ケースのみ'],
    ['usb-c-charger', 'USB-C ケーブル 2m 充電器 急速'],
    ['wireless-earphones', '骨伝導 ワイヤレスイヤホン'],
  ]) {
    assert.notEqual(reject(id, name), null, name);
  }
  assert.equal(reject('mobile-battery', 'USB充電器 20W'), 'not_the_product');
});

test('price range, review floor and availability are enforced', () => {
  const mb = cat('mobile-battery');
  assert.equal(rejectReason(item({ price: 500 }), mb), 'below_price_range');
  assert.equal(rejectReason(item({ reviews: 3 }), mb), 'too_few_reviews');
  assert.equal(rejectReason(item({ available: false }), mb), 'unavailable');
});

test('cleanTitle removes only the promo phrase, never the product name', () => {
  assert.equal(cleanTitle('【楽天1位】【P10倍】 電気ケトル 1.0L 送料無料 あす楽'), '電気ケトル 1.0L');
  assert.equal(cleanTitle('最大2000円OFFクーポン配布中モバイルバッテリー10000mAh 22.5W ケーブル内蔵'), 'モバイルバッテリー10000mAh 22.5W ケーブル内蔵');
  assert.equal(cleanTitle('ＵＳＢ充電器　６５Ｗ'), 'USB充電器 65W');
});

test('battery facets: stated Wh wins, estimates err high, flight class has a margin', () => {
  const mb = cat('mobile-battery');
  const stated = extractFacets(item({ name: 'モバイルバッテリー 20,000mAh ７４Wh 最大65W出力 PSE認証 約350g' }), mb);
  assert.equal(stated.capacity_mah, 20000);
  assert.equal(stated.output_w, 65);
  assert.equal(stated.energy_wh, 74);
  assert.equal(stated.energy_wh_source, 'stated');
  assert.equal(stated.flight_carry_on, 'ok');
  assert.equal(stated.weight_g, 350);
  assert.equal(stated.pse, true);
  const big = extractFacets(item({ name: 'モバイルバッテリー 27000mAh 140W' }), mb);
  assert.equal(big.energy_wh_source, 'estimated');
  assert.equal(big.flight_carry_on, 'airline_approval_needed');
  const nearLimit = extractFacets(item({ name: 'モバイルバッテリー 25600mAh 99.2Wh' }), mb);
  assert.equal(nearLimit.flight_carry_on, 'check_label');
});

test('facet regexes avoid known false positives', () => {
  const ear = cat('wireless-earphones');
  assert.equal(extractFacets(item({ name: 'ワイヤレスイヤホン Advanced Balanced' }), ear).anc, false);
  assert.equal(extractFacets(item({ name: 'ワイヤレスイヤホン ANC搭載' }), ear).anc, true);
  const hum = cat('humidifier');
  assert.equal(extractFacets(item({ name: '加湿器 ハイブリッド 加熱式 超音波 タンク 12L' }), hum).type, 'hybrid');
  assert.equal(extractFacets(item({ name: '加湿器 ハイブリッド タンク 12L' }), hum).tank_l, 12);
  const k = cat('electric-kettle');
  assert.equal(extractFacets(item({ name: '電気ケトル 800ml 1250W' }), k).capacity_l, 0.8);
  assert.equal(extractFacets(item({ name: '電気ケトル 【0.8L/1.0L/1.2L 選べる容量】' }), k).capacity_l, undefined);
  assert.equal(extractFacets(item({ name: 'ソニッケアー 電動歯ブラシ HX3671' }), cat('electric-toothbrush')).type, 'sonic');
});

test('variant listings are detected', () => {
  assert.equal(hasVariants('モバイルバッテリー 10000mAh/20000mAh'), true);
  assert.equal(hasVariants('電気ケトル 選べるカラー'), true);
  assert.equal(hasVariants('電気ケトル 1.0L 1250W'), false);
});

test('bayes score prefers many good reviews over a few perfect ones', () => {
  assert.ok(bayesScore(4.4, 3000, 4.2) > bayesScore(5.0, 3, 4.2));
});

test('dedupe: same model merges across shops, different capacities never do', () => {
  const mb = cat('mobile-battery');
  const f = (name) => ({ name, facets: extractFacets({ name }, mb) });
  assert.equal(sameProduct(f('モバイルバッテリー 10000mAh 22.5W 薄型 軽量'), f('モバイルバッテリー 20000mAh 22.5W 薄型 軽量')), false);
  assert.equal(sameProduct(f('Anker PowerCore 10000 A1263 モバイルバッテリー'), f('【公式】アンカー A1263 モバイルバッテリー 10000mAh PSE 送料無料 急速充電 iPhone')), true);
  // Different pack sizes of an otherwise identical listing stay separate.
  const pack = (name) => ({ name, facets: {}, unit: { quantity: Number(name.match(/(\d+)(?:kg|本)$/)[1]) } });
  assert.equal(sameProduct(pack('コシヒカリ 白米 精米 お米 単一原料米 5kg'), pack('コシヒカリ 白米 精米 お米 単一原料米 10kg')), false);
  assert.equal(sameProduct(pack('単3形 アルカリ乾電池 長期保存 液漏れ防止 20本'), pack('単3形 アルカリ乾電池 長期保存 液漏れ防止 40本')), false);
  assert.equal(sameProduct({ name: 'トイレットペーパー 12ロール 50m 再生紙 ダブル', facets: { ply: 'double' } }, { name: 'トイレットペーパー 12ロール 50m 再生紙 シングル', facets: { ply: 'single' } }), false);
  const k = cat('electric-kettle');
  const { items, stats } = rankCategory(
    [
      item({ id: 'a', name: '【P10倍】電気ケトル ステンレス 1.0L 転倒湯もれ防止 KT-100', price: 4000, reviews: 900 }),
      item({ id: 'b', name: '電気ケトル KT100 ステンレス 1.0L 送料無料', price: 3800, reviews: 200 }),
      item({ id: 'c', name: '電気ケトル 温度調節 0.8L ドリップ', price: 6000, reviews: 500 }),
    ],
    k,
  );
  assert.equal(items.length, 2);
  assert.equal(stats.rejected.duplicate, 1);
  assert.deepEqual(items.find((x) => x.id === 'a').otherOffers.map((o) => o.id), ['b']);
});

test('picks: best, cheapest among the top 40%, deal only on a cheap verdict', () => {
  const items = [
    { id: 'a', score: 4.6, price: 5000, priceStats: { verdict: 'usual', median90: 5000 } },
    { id: 'b', score: 4.5, price: 3000, priceStats: { verdict: 'usual', median90: 3000 } },
    { id: 'c', score: 4.4, price: 4000, priceStats: { verdict: 'below_usual', median90: 5000 } },
    { id: 'd', score: 4.0, price: 1000, priceStats: { verdict: 'insufficient_data' } },
    { id: 'e', score: 3.9, price: 900, priceStats: { verdict: 'lowest_observed', median90: 3000, suspicious: true } },
    { id: 'f', score: 3.8, price: 900, variants: true, priceStats: { verdict: 'lowest_observed', median90: 3000 } },
  ];
  assert.deepEqual(choosePicks(items), { best: 'a', budget: 'b', deal: 'c' });
});
