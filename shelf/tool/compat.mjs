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
    match: { model: '^IO[A-Z0-9]*', name: '\\biO\\b|iOシリーズ|オーラルB\\s*iO' },
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
    match: { name: 'ソニック|パルソニック|Pulsonic' },
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

// Rules are tried in order (exceptions first). A model number is matched
// against `model`; free text (a product name) against `name`.
export function checkCompatibility(input, rules = COMPAT_RULES) {
  const text = clean(input);
  if (!text) return { input: text, rule: null, verdict: 'unknown' };
  const model = text.toUpperCase().replace(/[\s-]/g, '');
  for (const rule of rules) {
    const byModel = rule.match.model && new RegExp(rule.match.model).test(model);
    const byName = rule.match.name && new RegExp(rule.match.name, 'i').test(text);
    if (byModel || byName) {
      return { input: text, rule: rule.id, heads: rule.heads, headCategory: rule.headCategory, verdict: rule.confidence, matchedBy: byModel ? 'model' : 'name', source: rule.source };
    }
  }
  return { input: text, rule: null, verdict: 'unknown' };
}
