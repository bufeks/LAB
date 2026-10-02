// Yahoo!ショッピング item search (Shopping Web API v3).
//
// With affiliate_type=vc and a ValueCommerce affiliate_id, every hit's `url`
// comes back as a ValueCommerce affiliate link. The API allows about 30
// requests a minute per appid; we stay under it. Pages that show its data
// must carry the "Webサービス by Yahoo! JAPAN" credit (see build.mjs).

const DEFAULT_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const MIN_INTERVAL_MS = Number(process.env.YAHOO_MIN_INTERVAL_MS) || 2100;

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function yahooCredentialsFromEnv(env = process.env) {
  const appId = env.YAHOO_APP_ID?.trim();
  if (!appId) return null;
  // The ValueCommerce referral URL for Yahoo!ショッピング, ending in "&vc_url=".
  const affiliateId = env.YAHOO_VC_AFFILIATE_ID?.trim();
  if (!affiliateId) {
    // Without it every Yahoo listing would be a plain link that can still
    // outrank (and replace) an affiliate one, so Yahoo is left out.
    if (!env.SHELF_QUIET) console.warn('YAHOO_APP_ID is set but YAHOO_VC_AFFILIATE_ID is not; Yahoo!ショッピング is skipped');
    return null;
  }
  return {
    appId,
    affiliateId,
    endpoint: env.YAHOO_ENDPOINT || DEFAULT_ENDPOINT,
  };
}

export function buildYahooUrl(creds, category) {
  const u = new URL(creds.endpoint);
  const p = u.searchParams;
  p.set('appid', creds.appId);
  p.set('query', category.yahooQuery || category.query);
  p.set('in_stock', 'true');
  p.set('condition', 'new');
  p.set('sort', '-review_count');
  p.set('results', '50');
  if (category.minPrice) p.set('price_from', String(category.minPrice));
  if (category.maxPrice) p.set('price_to', String(category.maxPrice));
  if (creds.affiliateId) {
    p.set('affiliate_type', 'vc');
    p.set('affiliate_id', creds.affiliateId);
  }
  return u;
}

export function normalizeYahooItem(hit, affiliated) {
  return {
    id: `yahoo:${hit.code}`,
    source: 'yahoo',
    name: String(hit.name || '').trim(),
    caption: String(hit.description || hit.headLine || '').slice(0, 1200),
    shop: hit.seller?.name || '',
    price: Number(hit.price),
    // 2 = 送料無料. 3 (条件付き送料無料) depends on the basket, so it counts as extra.
    shippingIncluded: Number(hit.shipping?.code) === 2,
    pointRate: 1,
    rating: Number(hit.review?.rate || 0),
    reviews: Number(hit.review?.count || 0),
    productUrl: hit.url,
    buyUrl: hit.url,
    affiliate: Boolean(affiliated),
    image: hit.image?.medium || null,
    available: hit.inStock !== false,
    jan: hit.janCode || null,
  };
}

export async function searchYahoo(creds, category) {
  const url = buildYahooUrl(creds, category);
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'SHELF/1.0 (+https://github.com/bufeks/LAB)', Accept: 'application/json' } });
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      return (data.hits || []).map((h) => normalizeYahooItem(h, creds.affiliateId));
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(4000 * 2 ** attempt);
      continue;
    }
    // Never echo the URL: it carries the appid.
    throw new Error(`Yahoo API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error('Yahoo API: retries exhausted');
}
