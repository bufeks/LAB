// Which replacement brush heads fit which electric toothbrush handle.
//
// Only family-level rules that the manufacturer states are encoded, each
// with its source and the quoted sentence. A model that matches no rule gets
// "unknown" and a pointer to the maker, never a guess: a wrong answer means
// a wasted purchase.

export const COMPAT_RULES = [
  {
    id: 'philips-one',
    brand: 'Philips',
    match: { model: '^HY\\d{4}', name: 'Philips\\s*One|フィリップス\\s*ワン' },
    heads: 'philips-one',
    headCategory: null,
    confidence: 'stated',
    source: {
      url: 'https://www.philips.co.jp/c-f/XC000006597/',
      quote: 'Philips One および Philips One for Kids ブラシヘッドは、Philips One および Philips One for Kids にのみ対応しています。',
    },
  },
  {
    id: 'sonicare-essence-legacy',
    brand: 'Philips Sonicare',
    match: { name: 'エッセンス|Essence' },
    heads: 'sonicare-screw-on',
    headCategory: null,
    confidence: 'check',
    source: {
      url: 'https://www.philips.co.jp/c-f/XC000006597/',
      quote: 'エッセンスの旧モデルには、大きめのねじ込み式ブラシヘッドが付いています。',
    },
  },
  {
    id: 'sonicare-click-on',
    brand: 'Philips Sonicare',
    match: { model: '^HX\\d{4}', name: 'ソニッケアー|Sonicare' },
    heads: 'sonicare-click-on',
    headCategory: 'sonicare-heads',
    confidence: 'stated',
    source: {
      url: 'https://www.philips.co.jp/c-f/XC000006597/',
      quote: '標準的なはめ込み式ブラシヘッドは、ほとんどのソニッケアー充電式歯ブラシに使用できます。',
    },
  },
  {
    id: 'oralb-io',
    brand: 'Braun Oral-B',
    match: { model: '^IOM?\\d', name: '(?<![A-Za-z])iO(?![A-Za-z])(?!S)|iOシリーズ|オーラルB\\s*iO' },
    heads: 'oralb-io',
    headCategory: null,
    confidence: 'stated',
    source: {
      url: 'https://www.oralb-braun-onlinestore.jp/f/faq',
      quote: '「iOシリーズ」については専用の替えブラシがございます。他の替えブラシとの互換性はありませんので、ご注意ください。',
    },
  },
  {
    id: 'oralb-sonic-oval',
    brand: 'Braun Oral-B',
    match: { name: '(?<!パナ)ソニック|パルソニック|Pulsonic' },
    heads: 'oralb-oval',
    headCategory: null,
    confidence: 'check',
    source: {
      url: 'https://www.oralb-braun-onlinestore.jp/f/faq',
      quote: '丸型ブラシと楕円型ブラシは、お使いいただく本体の機種が異なりますので、ご注意ください。',
    },
  },
  {
    id: 'oralb-round',
    brand: 'Braun Oral-B',
    // Braun Oral-B rotating handles carry model numbers like D100, D305, D601.
    match: { model: '^D\\d{2,3}', name: 'オーラルB|オーラルビー|Oral-?B|ブラウン' },
    heads: 'oralb-round',
    headCategory: 'oralb-heads',
    confidence: 'stated',
    source: {
      url: 'https://www.oralb-braun-onlinestore.jp/f/faq',
      quote: 'どの替えブラシも、ブラウン（オーラルB）電動歯ブラシ本体に装着できる…※「iOシリーズ」については専用の替えブラシがございます。',
    },
  },
];

const clean = (s) => String(s ?? '').normalize('NFKC').trim();

// A model number is the strongest evidence, so every rule's `model` pattern
// is tried first (against the whole input and each word in it); only then
// the `name` patterns, in order (exceptions first). "エッセンス+ HX3274" is
// a click-on HX handle, not a legacy Essence.
const PANASONIC = /パナソニック|Panasonic|ドルツ|Doltz/i;

export function checkCompatibility(input, rules = COMPAT_RULES) {
  const text = clean(input);
  if (!text) return { input: text, rule: null, verdict: 'unknown' };
  const hit = (rule, matchedBy) => ({ input: text, rule: rule.id, heads: rule.heads, headCategory: rule.headCategory, verdict: rule.confidence, matchedBy, source: rule.source });
  // Other makers' handles are out of scope: say unknown rather than match
  // a word inside their name.
  if (PANASONIC.test(text)) return { input: text, rule: null, verdict: 'unknown' };
  const models = [text, ...text.split(/[\s/,、（）()]+/)].map((w) => w.toUpperCase().replace(/[\s-]/g, '')).filter(Boolean);
  for (const rule of rules) {
    if (rule.match.model && models.some((m) => new RegExp(rule.match.model).test(m))) return hit(rule, 'model');
  }
  for (const rule of rules) {
    if (rule.match.name && new RegExp(rule.match.name, 'i').test(text)) return hit(rule, 'name');
  }
  return { input: text, rule: null, verdict: 'unknown' };
}
