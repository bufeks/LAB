import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildSearchUrl, credentialsFromEnv, normalizeItem, searchCategory } from '../rakuten.mjs';
import { CATEGORIES } from '../categories.mjs';

const raw = {
  itemName: '【P5倍】モバイルバッテリー 10000mAh',
  itemCode: 'shop:123',
  itemPrice: 2980,
  itemUrl: 'https://item.rakuten.co.jp/shop/123/',
  affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=y',
  shopName: 'ショップ',
  reviewCount: 1200,
  reviewAverage: 4.41,
  pointRate: 5,
  postageFlag: 0,
  availability: 1,
  mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128'],
};

test('credentials need both application id and access key', () => {
  assert.equal(credentialsFromEnv({ RAKUTEN_APP_ID: 'x' }), null);
  assert.ok(credentialsFromEnv({ RAKUTEN_APP_ID: 'x', RAKUTEN_ACCESS_KEY: 'y' }));
});

test('search url carries the category rules', () => {
  const creds = credentialsFromEnv({ RAKUTEN_APP_ID: 'app', RAKUTEN_ACCESS_KEY: 'key', RAKUTEN_AFFILIATE_ID: 'aff' });
  const u = buildSearchUrl(creds, CATEGORIES[0], 2);
  assert.equal(u.searchParams.get('affiliateId'), 'aff');
  assert.equal(u.searchParams.get('sort'), '-reviewCount');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('formatVersion'), '2');
  assert.equal(u.searchParams.get('NGKeyword'), CATEGORIES[0].ngKeywords.join(' '));
});

test('normalizeItem maps fields and prefers the affiliate url', () => {
  const x = normalizeItem(raw);
  assert.equal(x.id, 'rakuten:shop:123');
  assert.equal(x.buyUrl, raw.affiliateUrl);
  assert.equal(x.affiliate, true);
  assert.equal(x.shippingIncluded, true);
  assert.equal(x.image, 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300');
  assert.equal(normalizeItem({ ...raw, affiliateUrl: '' }).buyUrl, raw.itemUrl);
});

function mockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('client sends referer, origin and access key, and pages through results', async () => {
  const seen = [];
  const server = await mockServer((req, res) => {
    seen.push({ url: new URL(req.url, 'http://x'), headers: req.headers });
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ pageCount: 2, Items: [{ ...raw, itemCode: `shop:${page}` }] }));
  });
  const { port } = server.address();
  const creds = credentialsFromEnv({
    RAKUTEN_APP_ID: 'app',
    RAKUTEN_ACCESS_KEY: 'secret-key',
    RAKUTEN_ENDPOINT: `http://127.0.0.1:${port}/search`,
    RAKUTEN_REFERER: 'https://bufeks.github.io/',
  });
  const items = await searchCategory(creds, CATEGORIES[0]);
  server.close();
  assert.deepEqual(items.map((x) => x.id), ['rakuten:shop:1', 'rakuten:shop:2']);
  assert.equal(seen[0].headers.referer, 'https://bufeks.github.io/');
  assert.equal(seen[0].headers.origin, 'https://bufeks.github.io');
  assert.equal(seen[0].headers.accesskey, 'secret-key');
});

test('errors do not leak credentials', async () => {
  const server = await mockServer((req, res) => {
    res.statusCode = 403;
    res.end('{"errors":{"errorMessage":"REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING"}}');
  });
  const { port } = server.address();
  const creds = credentialsFromEnv({ RAKUTEN_APP_ID: 'app-id-123', RAKUTEN_ACCESS_KEY: 'secret-key', RAKUTEN_ENDPOINT: `http://127.0.0.1:${port}/s` });
  await assert.rejects(searchCategory(creds, CATEGORIES[0]), (err) => {
    assert.match(err.message, /403.*REFERRER_MISSING/);
    assert.doesNotMatch(err.message, /secret-key|app-id-123/);
    return true;
  });
  server.close();
});
