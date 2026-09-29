// Runs the daily job in live mode against a mock Rakuten API, then checks the
// audit passes and that a keyless run refuses to overwrite live history.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const TITLES = {
  モバイルバッテリー: ['モバイルバッテリー 10000mAh 22.5W PSE A1001', 'モバイルバッテリー 20000mAh 65W PSE B2002', '【P10倍】モバイルバッテリー 5000mAh マグネット C3003', 'モバイルバッテリー用 収納ケース'],
  'USB-C 充電器 PD': ['USB-C 充電器 65W 3ポート GaN D4004', 'USB 充電器 20W PD E5005', 'USB-C 充電器 100W GaN F6006', 'Type-C ケーブル 1m 充電器対応'],
  ワイヤレスイヤホン: ['ワイヤレスイヤホン ノイズキャンセリング G7007', 'ワイヤレスイヤホン LDAC マルチポイント H8008', 'ワイヤレスイヤホン IPX5 J9009', 'イヤーピース イヤホン用'],
  電気ケトル: ['電気ケトル 1.0L 温度調節 K1010', '電気ケトル 0.8L 転倒湯もれ防止 L1111', '電気ケトル 1.2L M1212', 'ケトル用 パッキン'],
  加湿器: ['加湿器 スチーム式 8畳 N1313', '加湿器 気化式 18畳 P1414', '加湿器 ハイブリッド 14畳 Q1515', '交換用フィルター 加湿器'],
  電動歯ブラシ: ['電動歯ブラシ 音波 R1616', '電動歯ブラシ 回転 S1717', '電動歯ブラシ 音波 タイマー T1818', '替えブラシ 4本 電動歯ブラシ用'],
};

function mockRakuten() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const keyword = u.searchParams.get('keyword');
    const aff = u.searchParams.get('affiliateId');
    const items = (TITLES[keyword] || []).map((name, i) => ({
      itemName: name,
      itemCode: `shop${i}:${keyword.length}-${i}`,
      itemPrice: Number(u.searchParams.get('minPrice')) + 1000 * (i + 1),
      itemUrl: `https://item.rakuten.co.jp/shop${i}/${i}/`,
      affiliateUrl: aff ? `https://hb.afl.rakuten.co.jp/hgc/${aff}/?pc=${i}` : '',
      shopName: `店${i}`,
      reviewCount: 100 * (i + 1),
      reviewAverage: 4.2 + i / 20,
      pointRate: 1,
      postageFlag: 0,
      availability: 1,
      mediumImageUrls: [],
    }));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ pageCount: 1, Items: items }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('live run: real-shaped data, affiliate links, clean audit, guarded history', { timeout: 60000 }, async () => {
  const server = await mockRakuten();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-live-'));
  const base = { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out') };
  const live = {
    ...base,
    RAKUTEN_APP_ID: 'app',
    RAKUTEN_ACCESS_KEY: 'key',
    RAKUTEN_AFFILIATE_ID: 'aff123',
    RAKUTEN_ENDPOINT: `http://127.0.0.1:${server.address().port}/search`,
    RAKUTEN_MIN_INTERVAL_MS: '10',
  };
  try {
    await run(process.execPath, [path.join(TOOL, 'update.mjs')], { env: live });
    const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'out/api/v1/c/mobile-battery.json'), 'utf8'));
    assert.equal(rec.sample, false);
    assert.equal(rec.items.length, 3, 'the case listing is filtered out');
    assert.ok(rec.items.every((x) => x.affiliate && x.buy_url.includes('aff123')));
    assert.match(rec.disclosure, /アフィリエイト/);
    assert.equal(rec.items[0].price_check.verdict, 'insufficient_data');
    const audit = await run(process.execPath, [path.join(TOOL, 'check.mjs')], { env: live });
    assert.match(audit.stdout, /### Errors\nnone/);

    const historyFile = path.join(tmp, 'data/history/mobile-battery.json');
    const before = fs.readFileSync(historyFile, 'utf8');
    await assert.rejects(run(process.execPath, [path.join(TOOL, 'update.mjs')], { env: { ...base, RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '' } }), /force-sample/);
    assert.equal(fs.readFileSync(historyFile, 'utf8'), before);

    // Without an affiliate id the links earn nothing: the audit must fail and the disclosure must not claim affiliation.
    await run(process.execPath, [path.join(TOOL, 'update.mjs')], { env: { ...live, RAKUTEN_AFFILIATE_ID: '' } });
    const plain = JSON.parse(fs.readFileSync(path.join(tmp, 'out/api/v1/c/mobile-battery.json'), 'utf8'));
    assert.match(plain.disclosure, /アフィリエイトなし/);
    await assert.rejects(run(process.execPath, [path.join(TOOL, 'check.mjs')], { env: live }), (err) => /affiliate links/.test(err.stdout));
  } finally {
    server.close();
  }
});
