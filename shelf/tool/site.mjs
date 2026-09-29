// Site-wide settings. Everything that differs between deployments is read
// from the environment so that forks only have to set repository secrets.

export const SITE = {
  name: 'SHELF',
  tagline: 'AIエージェントのための買い物データ',
  // Absolute URL of the published shelf/ directory, without a trailing slash.
  baseUrl: (process.env.SHELF_BASE_URL || 'https://bufeks.github.io/LAB/shelf').replace(/\/$/, ''),
  // Rakuten checks Referer/Origin against the app's "allowed websites".
  refererUrl: process.env.RAKUTEN_REFERER || 'https://bufeks.github.io/',
  apiVersion: 'v1',
  // Set when the build is served by the SHELF Cloudflare Worker: buy links go
  // through /go/ (click counting) and the remote MCP endpoint is advertised.
  edge: process.env.SHELF_EDGE === '1',
  timeZone: 'Asia/Tokyo',
  disclosure:
    'PR: 購入リンクは楽天アフィリエイトリンクです。リンク経由で購入されると運営者に紹介料が入りますが、' +
    '価格は変わらず、順位は公開している計算式だけで決まり、紹介料の率は順位に影響しません。',
  disclosureEn:
    'Purchase links are Rakuten affiliate links; the operator earns a commission on purchases at no extra cost ' +
    'to the buyer. Rankings come only from the published formula and are not influenced by commission rates.',
  credit: {
    text: 'Supported by Rakuten Developers',
    url: 'https://developers.rakuten.com/',
  },
};

// ISO-8601 with the +09:00 offset, so "updated at" and the JST data date
// never disagree about which day it is.
export function isoJst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().replace(/\.\d+Z$/, '+09:00');
}

export function todayJst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timeZone }).format(now);
}

// Tracked buy link, resolved by the Worker from the published data (never
// from the URL itself, so it cannot be used as an open redirect).
export function goUrl(categoryId, itemId, surface, lang = 'ja') {
  return `${SITE.baseUrl}/go/${categoryId}/${encodeURIComponent(itemId)}?s=${surface}${lang === 'ja' ? '' : `&l=${lang}`}`;
}

// The same link, re-labelled for the surface it is shown on.
export function via(url, surface) {
  return SITE.edge && url.includes('/go/') ? url.replace(/([?&]s=)[a-z]+/, `$1${surface}`) : url;
}
