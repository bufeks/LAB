// Rakuten Ichiba item search, 2026 API platform.
//
// The platform wants applicationId *and* accessKey, and rejects requests whose
// Referer/Origin is not one of the app's registered "allowed websites"
// (403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING). fetch() may drop a
// Referer header, so this goes through node:https directly.

import https from 'node:https';
import http from 'node:http';

const DEFAULT_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601';
// The platform returns 429 below ~1.5s; tests against a mock may go faster.
const MIN_INTERVAL_MS = Number(process.env.RAKUTEN_MIN_INTERVAL_MS) || 1600;

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function credentialsFromEnv(env = process.env) {
  const applicationId = env.RAKUTEN_APP_ID?.trim();
  const accessKey = env.RAKUTEN_ACCESS_KEY?.trim();
  if (!applicationId || !accessKey) return null;
  return {
    applicationId,
    accessKey,
    affiliateId: env.RAKUTEN_AFFILIATE_ID?.trim() || undefined,
    endpoint: env.RAKUTEN_ENDPOINT || DEFAULT_ENDPOINT,
    // Travel and Books live elsewhere on the same platform; overridable for tests.
    travelEndpoint: env.RAKUTEN_TRAVEL_ENDPOINT || undefined,
    booksEndpoint: env.RAKUTEN_BOOKS_ENDPOINT || undefined,
    referer: env.RAKUTEN_REFERER || 'https://bufeks.github.io/',
  };
}

export function buildSearchUrl(creds, category, page) {
  const u = new URL(creds.endpoint);
  const p = u.searchParams;
  p.set('applicationId', creds.applicationId);
  p.set('accessKey', creds.accessKey);
  if (creds.affiliateId) p.set('affiliateId', creds.affiliateId);
  p.set('format', 'json');
  p.set('formatVersion', '2');
  p.set('keyword', category.query);
  if (category.ngKeywords?.length) p.set('NGKeyword', category.ngKeywords.join(' '));
  if (category.minPrice) p.set('minPrice', String(category.minPrice));
  if (category.maxPrice) p.set('maxPrice', String(category.maxPrice));
  if (category.genreId) p.set('genreId', String(category.genreId));
  p.set('availability', '1');
  p.set('hasReviewFlag', '1');
  p.set('sort', '-reviewCount');
  p.set('hits', '30');
  p.set('page', String(page));
  return u;
}

function get(url, headers) {
  const lib = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers, timeout: 20000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export async function rakutenGet(creds, url) {
  const origin = new URL(creds.referer).origin;
  const headers = {
    'User-Agent': 'SHELF/1.0 (+https://github.com/bufeks/LAB)',
    Accept: 'application/json',
    Referer: creds.referer,
    Origin: origin,
    accessKey: creds.accessKey,
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try {
      res = await get(url, headers);
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 200) return JSON.parse(res.body);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    // Never echo the URL: it carries the credentials.
    throw new Error(`Rakuten API ${res.status}: ${res.body.slice(0, 300)}`);
  }
  throw new Error('Rakuten API: retries exhausted');
}

// Normalises one Rakuten item (formatVersion=2) into SHELF's item shape.
export function normalizeItem(raw) {
  const images = (raw.mediumImageUrls || []).map((x) => (typeof x === 'string' ? x : x.imageUrl));
  return {
    id: `rakuten:${raw.itemCode}`,
    source: 'rakuten',
    name: String(raw.itemName || '').trim(),
    caption: String(raw.itemCaption || '').slice(0, 1200),
    shop: raw.shopName || '',
    price: Number(raw.itemPrice),
    shippingIncluded: raw.postageFlag === 0,
    pointRate: Number(raw.pointRate || 1),
    rating: Number(raw.reviewAverage || 0),
    reviews: Number(raw.reviewCount || 0),
    productUrl: raw.itemUrl,
    buyUrl: raw.affiliateUrl || raw.itemUrl,
    affiliate: Boolean(raw.affiliateUrl),
    image: images[0] ? images[0].replace(/\?_ex=\d+x\d+$/, '?_ex=300x300') : null,
    available: raw.availability !== 0,
  };
}

export async function searchCategory(creds, category, pages = 2) {
  const items = [];
  for (let page = 1; page <= pages; page++) {
    const data = await rakutenGet(creds, buildSearchUrl(creds, category, page));
    const list = data.Items || data.items || [];
    items.push(...list.map((x) => normalizeItem(x.Item || x)));
    if (!data.pageCount || page >= data.pageCount) break;
  }
  return items;
}
