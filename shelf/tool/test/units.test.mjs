import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, unitValue } from '../units.mjs';

test('mass and volume totals from real-looking titles', () => {
  assert.equal(parseQuantity('【令和6年産】コシヒカリ 10kg (5kg×2袋) 送料無料', 'mass'), 10000);
  assert.equal(parseQuantity('新米 あきたこまち 5kg', 'mass'), 5000);
  assert.equal(parseQuantity('ブレンド米 5kg×4袋 20kg', 'mass'), 20000);
  assert.equal(parseQuantity('コーヒー豆 500g×2袋 1kg 深煎り', 'mass'), 1000);
  assert.equal(parseQuantity('ホエイプロテイン 1kg', 'mass'), 1000);
  assert.equal(parseQuantity('天然水 2L×9本', 'volume'), 18000);
  assert.equal(parseQuantity('ミネラルウォーター 2Ｌ 9本', 'volume'), 18000);
  assert.equal(parseQuantity('天然水 500ml×24本×2ケース', 'volume'), 24000);
  assert.equal(parseQuantity('お茶 525ml 24本入', 'volume'), 12600);
});

test('ambiguous or variant titles give no quantity', () => {
  assert.equal(parseQuantity('コシヒカリ 5kg 10kg 選べる', 'mass'), null);
  assert.equal(parseQuantity('ブレンド米 お徳用', 'mass'), null);
  assert.equal(parseQuantity('天然水 2L×9本 500ml×24本', 'volume'), null);
});

test('counts and toilet paper', () => {
  assert.equal(parseQuantity('単3形 アルカリ乾電池 40本', 'count'), 40);
  assert.equal(parseQuantity('アルカリ乾電池 単3 20本×2パック', 'count'), 40);
  assert.equal(parseQuantity('トイレットペーパー 12ロール 50m ダブル', 'paper'), 1200);
  assert.equal(parseQuantity('トイレットペーパー シングル 100m×12ロール 114mm', 'paper'), 1200);
  assert.equal(parseQuantity('トイレットペーパー 2倍巻き 12ロール', 'paper'), null);
  assert.equal(parseQuantity('トイレットペーパー 12ロール 50m', 'paper'), null);
});

test('unit values: price per unit, or quantity per 10,000 yen', () => {
  assert.deepEqual(unitValue({ name: 'コシヒカリ 10kg', price: 5000 }, { kind: 'mass', per: 1000 }), { quantity: 10000, value: 500 });
  assert.deepEqual(unitValue({ name: 'ふるさと納税 米 15kg', price: 20000 }, { kind: 'mass', per: 1000, perYen: 10000 }), { quantity: 15000, value: 7.5 });
  assert.equal(unitValue({ name: 'コシヒカリ 300kg', price: 5000 }, { kind: 'mass', per: 1000, max: 60000 }), null);
});
