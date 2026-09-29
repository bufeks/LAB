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

export function todayJst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timeZone }).format(now);
}
