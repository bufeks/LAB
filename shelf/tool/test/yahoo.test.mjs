import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildYahooUrl, normalizeYahooItem, searchYahoo, yahooCredentialsFromEnv } from '../yahoo.mjs';
import { CATEGORIES } from '../categories.mjs';

const hit = {
  name: 'モバイルバッテリー 10000mAh A1263',
  code: 'store_a1263',
  price: 2990,
  inStock: true,
  url: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=1&pid=2&vc_url=x',
  review: { rate: 4.4, count: 321 },
  shipping: { code: 2, name: '送料無料' },
  seller: { name: 'ストアA' },
  image: { medium: 'https://item-shopping.c.yimg.jp/i/g/a.jpg' },
  janCode: '4589999999999',
};

test('credentials need an app id; the affiliate id is optional', () => {
  assert.equal(yahooCredentialsFromEnv({}), null);
  assert.equal(yahooCredentialsFromEnv({ YAHOO_APP_ID: 'a', SHELF_QUIET: '1' }), null);
});

test('search url carries price range, stock, sort and affiliate', () => {
  const u = buildYahooUrl({ appId: 'a', affiliateId: 'vc-id', endpoint: 'https://x/y' }, CATEGORIES[0]);
  assert.equal(u.searchParams.get('sort'), '-review_count');
  assert.equal(u.searchParams.get('in_stock'), 'true');
  assert.equal(u.searchParams.get('affiliate_type'), 'vc');
  assert.equal(u.searchParams.get('price_from'), String(CATEGORIES[0].minPrice));
});

test('normalize: shipping code 2 is included, 3 (conditional) is not', () => {
  const x = normalizeYahooItem(hit, true);
  assert.equal(x.id, 'yahoo:store_a1263');
  assert.equal(x.source, 'yahoo');
  assert.equal(x.shippingIncluded, true);
  assert.equal(x.affiliate, true);
  assert.equal(x.jan, '4589999999999');
  assert.equal(normalizeYahooItem({ ...hit, shipping: { code: 3 } }, false).shippingIncluded, false);
});

test('client calls the API and never leaks the app id in errors', async () => {
  let seen;
  const server = http.createServer((req, res) => {
    seen = new URL(req.url, 'http://x');
    if (seen.searchParams.get('query') === 'fail') {
      res.statusCode = 400;
      return res.end('{"Error":{"Message":"bad"}}');
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ totalResultsAvailable: 1, hits: [hit] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.YAHOO_MIN_INTERVAL_MS = '1';
  const creds = { appId: 'secret-app', endpoint: `http://127.0.0.1:${server.address().port}/s` };
  const items = await searchYahoo(creds, CATEGORIES[0]);
  assert.equal(items[0].id, 'yahoo:store_a1263');
  assert.equal(seen.searchParams.get('appid'), 'secret-app');
  await assert.rejects(searchYahoo(creds, { ...CATEGORIES[0], query: 'fail' }), (e) => /400/.test(e.message) && !/secret-app/.test(e.message));
  server.close();
});
