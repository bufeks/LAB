#!/usr/bin/env node
// Renders data/ into the published shelf/ directory, once per language.
// Each category is served four ways, all generated from the same record:
//
//   [<lang>/]c/<id>.md            clean Markdown — what an LLM reads and quotes
//   api/v1/[<lang>/]c/<id>.json   structured data — what an agent or tool filters
//   [<lang>/]c/<id>/index.html    the page a person lands on from an AI answer
//   [<lang>/]llms.txt, openapi.json, sitemap.xml   how agents find all of it
//
// Japanese (the source) has no <lang>/ prefix, so its URLs never change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './categories.mjs';
import { SITE, todayJst, goUrl, via } from './site.mjs';
import { LOCALES, SOURCE, prefix, ui, localizeCategory, verdictText, fill, byLang } from './i18n/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SHELF_DATA_DIR || path.join(HERE, '..', 'data');
const OUT_DIR = process.env.SHELF_OUT_DIR || path.join(HERE, '..');
const STALE_AFTER_DAYS = 3;
const EN = byLang('en');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mdCell = (s) => String(s ?? '').replace(/\|/g, '／').replace(/\s+/g, ' ');
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function write(rel, content) {
  const file = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 1) + '\n');
}

const url = (rel) => `${SITE.baseUrl}/${rel}`;
const pageUrl = (L, rel = '') => url(`${prefix(L)}${rel}`);
const apiUrl = (L, rel) => url(`api/${SITE.apiVersion}/${prefix(L)}${rel}`);
// The agent guide exists in Japanese and English; other languages use English.
const aboutUrl = (L) => (L === SOURCE ? url('about/') : url('en/about/'));
const links = (id, L) => ({
  html: pageUrl(L, `c/${id}/`),
  markdown: pageUrl(L, `c/${id}.md`),
  json: apiUrl(L, `c/${id}.json`),
});
const englishName = (category) => EN.categories[category.id]?.name ?? category.nameEn;

// ---------------------------------------------------------------- records

function specFields(category, loc) {
  const valuesOf = (key, values) => values.map((value) => ({ value, label: loc.option(key, value) }));
  const derivedValues = { flight_carry_on: ['ok', 'check_label', 'airline_approval_needed', 'not_allowed'], energy_wh_source: ['stated', 'estimated'] };
  return [
    ...category.facets.map(({ key, type, options }) => ({
      key,
      label: loc.label(key),
      unit: loc.unit(key),
      type,
      ...(options ? { values: valuesOf(key, options.map((o) => o.value)) } : {}),
    })),
    ...(category.derived || []).map(({ key }) => ({
      key,
      label: loc.label(key),
      unit: loc.unit(key),
      type: derivedValues[key] ? 'enum' : 'number',
      ...(derivedValues[key] ? { values: derivedValues[key].map((value) => ({ value, label: loc.derivedValue(key, value) })) } : {}),
    })),
  ];
}

function publicItem(item, categoryId, L) {
  const link = (id, direct) => (SITE.edge ? goUrl(categoryId, id, 'api', L.slug) : direct);
  const ps = item.priceStats || {};
  const offers = (item.otherOffers || [])
    .slice(0, 3)
    .map((o) => ({ id: o.id, shop: o.shop, price: o.price, shipping_included: o.shippingIncluded ?? null, buy_url: link(o.id, o.buyUrl), affiliate_url: o.buyUrl }));
  return {
    id: item.id,
    rank: item.rank,
    title: item.title,
    name: item.name,
    shop: item.shop,
    price: item.price,
    currency: 'JPY',
    shipping_included: item.shippingIncluded,
    point_rate: item.pointRate,
    rating: item.rating,
    reviews: item.reviews,
    score: item.score,
    variants: Boolean(item.variants),
    price_check: {
      verdict: ps.verdict || 'insufficient_data',
      label: verdictText(L, ps),
      min_90d: ps.min90 ?? null,
      median_90d: ps.median90 ?? null,
      max_90d: ps.max90 ?? null,
      observed_days: ps.points ?? 0,
      window_days: ps.windowDays ?? 0,
      first_seen: ps.firstSeen ?? null,
      weekly_low: item.priceWeekly || [],
      ...(ps.suspicious ? { suspicious: true } : {}),
    },
    specs: item.facets || {},
    buy_url: link(item.id, item.buyUrl),
    affiliate_url: item.buyUrl,
    affiliate: Boolean(item.affiliate),
    product_url: item.productUrl,
    image: item.image,
    other_offers: offers,
  };
}

// Category-level answer to "is now a good time to buy X?".
export function priceOutlook(items, L = SOURCE) {
  const judged = items.filter((x) => x.price_check.verdict !== 'insufficient_data');
  const window = Math.max(0, ...items.map((x) => x.price_check.window_days));
  if (judged.length < 3) {
    return { verdict: 'insufficient_data', judged_items: judged.length, window_days: window, summary: L.outlook.insufficient };
  }
  const cheap = judged.filter((x) => ['lowest_observed', 'below_usual'].includes(x.price_check.verdict)).length / judged.length;
  const dear = judged.filter((x) => x.price_check.verdict === 'above_usual').length / judged.length;
  const verdict = cheap >= 0.3 && cheap > dear ? 'cheaper_than_usual' : dear >= 0.3 && dear > cheap ? 'pricier_than_usual' : 'usual';
  const summary = {
    cheaper_than_usual: fill(L.outlook.cheaper, { pct: Math.round(cheap * 100) }),
    pricier_than_usual: fill(L.outlook.pricier, { pct: Math.round(dear * 100) }),
    usual: L.outlook.usual,
  }[verdict];
  return {
    verdict,
    share_cheaper: Math.round(cheap * 100) / 100,
    share_pricier: Math.round(dear * 100) / 100,
    judged_items: judged.length,
    window_days: window,
    summary: summary + fill(L.outlook.suffix, { days: window }),
  };
}

function disclosureFor(sample, items, L) {
  const kind = sample ? 'sample' : items.length && !items.some((x) => x.affiliate) ? 'plain' : 'affiliate';
  return { text: L.disclosure[kind], en: EN.disclosure[kind] };
}

export function categoryRecord(category, latest, state, buildDate, L = SOURCE) {
  const sample = state.mode !== 'live';
  const loc = localizeCategory(category, L);
  const age = latest ? daysBetween(latest.date, buildDate) : Infinity;
  const status = !latest ? 'no_data' : age > STALE_AFTER_DAYS ? 'stale' : 'ok';
  const items = (latest?.items || []).map((x) => publicItem(x, category.id, L));
  const reasons = { best: ui(L, 'reasonBest'), budget: ui(L, 'reasonBudget'), deal: ui(L, 'reasonDeal') };
  const picks = {};
  for (const [kind, id] of Object.entries(latest?.picks || {})) {
    const item = items.find((x) => x.id === id);
    if (item) picks[kind] = { id, reason: reasons[kind], title: item.title, price: item.price, buy_url: item.buy_url };
  }
  const disclosure = disclosureFor(sample, items, L);
  const l = links(category.id, L);
  return {
    schema: 'shelf.category/v1',
    lang: L.lang,
    translated: loc.translated,
    id: category.id,
    name: loc.name,
    name_ja: category.name,
    name_en: englishName(category),
    names: Object.fromEntries(LOCALES.map((X) => [X.lang, localizeCategory(category, X).name])),
    status,
    sample,
    updated_at: latest?.fetchedAt ?? null,
    data_date: latest?.date ?? null,
    disclosure: disclosure.text,
    disclosure_en: disclosure.en,
    citation: {
      title: `${fill(ui(L, 'pageTitle'), { name: loc.name })} — SHELF`,
      url: l.html,
      data_date: latest?.date ?? null,
      note: disclosure.text,
    },
    market: { country: 'JP', currency: 'JPY', store: 'Rakuten Ichiba', ...(L === SOURCE ? {} : { for_visitors: ui(L, 'visitorNote') }) },
    how_to_choose: loc.guide,
    price_outlook: priceOutlook(items, L),
    method: L.method,
    spec_fields: specFields(category, loc),
    picks,
    items,
    stats: latest?.stats ?? null,
    links: l,
    languages: Object.fromEntries(LOCALES.map((X) => [X.lang, links(category.id, X)])),
    source: { name: 'Rakuten Ichiba', credit: SITE.credit },
  };
}

// ---------------------------------------------------------------- shared text

function specText(item, fields, sep) {
  return fields
    .filter((f) => item.specs[f.key] != null && item.specs[f.key] !== false && f.key !== 'energy_wh_source')
    .map((f) => {
      const v = item.specs[f.key];
      if (f.type === 'flag') return f.label;
      if (f.values) return f.values.find((o) => o.value === v)?.label ?? String(v);
      return `${f.label} ${v}${f.unit ? (/^[A-Za-z]/.test(f.unit) && f.unit.length > 3 ? ` ${f.unit}` : f.unit) : ''}`;
    })
    .join(sep);
}

const SEP = { ja: '・', en: ' · ', 'zh-Hans': '、', 'zh-Hant': '、', ko: ' · ' };
const ratingText = (L, x) => ui(L, 'rating', { rating: x.rating.toFixed(2), reviews: x.reviews.toLocaleString(L.numberLocale) });

// ---------------------------------------------------------------- markdown

export function categoryMarkdown(rec, L = SOURCE) {
  const money = L.money;
  const sep = SEP[L.lang] ?? ' · ';
  const out = [];
  out.push(`# ${fill(ui(L, 'pageTitle'), { name: rec.name })} — SHELF`, '');
  out.push(`> ${rec.disclosure}`);
  out.push(`> ${ui(L, 'dataLine', { date: rec.data_date ?? '—', status: rec.status, credit: SITE.credit.text })}`, '');
  if (rec.sample) out.push(ui(L, 'sampleNotice'), '');
  if (rec.market.for_visitors) out.push(`> **${ui(L, 'visitorTitle')}**: ${rec.market.for_visitors}`, '');
  out.push(`## ${ui(L, 'bottomLine')}`, '');
  const pickLabel = { best: ui(L, 'pickBest'), budget: ui(L, 'pickBudget'), deal: ui(L, 'pickDeal') };
  for (const kind of ['best', 'budget', 'deal']) {
    const p = rec.picks[kind];
    if (!p) continue;
    const item = rec.items.find((x) => x.id === p.id);
    out.push(`- **${pickLabel[kind]}**: ${item.title} — ${money(item.price)} ${ratingText(L, item)}, ${ui(L, 'priceCheck')}: ${item.price_check.label} → [${ui(L, 'buyLink')}](${via(item.buy_url, 'md')})`);
  }
  out.push(`- **${ui(L, 'outlookLabel')}**: ${rec.price_outlook.summary}`, '');
  out.push(rec.how_to_choose.summary, '');
  out.push(`## ${ui(L, 'howToChoose')}${rec.how_to_choose.asOf ? ui(L, 'asOf', { date: rec.how_to_choose.asOf }) : ''}`, '');
  for (const c of rec.how_to_choose.criteria) out.push(`- **${c.name}**: ${c.detail}`);
  out.push('', `### ${ui(L, 'pitfalls')}`, '');
  for (const p of rec.how_to_choose.pitfalls) out.push(`- ${p}`);
  if (rec.how_to_choose.abroad) out.push(`- **${ui(L, 'abroadLabel')}**: ${rec.how_to_choose.abroad}`);
  out.push('', `## ${ui(L, 'ranking')}`, '');
  out.push(`| ${['colRank', 'colProduct', 'colPrice', 'colRating', 'colPriceCheck', 'colSpecs', 'colBuy'].map((k) => ui(L, k)).join(' | ')} |`);
  out.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const x of rec.items) {
    const ship = x.shipping_included ? ui(L, 'shipIncluded') : ui(L, 'shipExtra');
    const pc = x.price_check;
    const range = pc.median_90d ? ui(L, 'medianObserved', { median: money(pc.median_90d), days: pc.window_days }) : '';
    const variantNote = x.variants ? ui(L, 'variantNote') : '';
    out.push(
      `| ${x.rank} | ${mdCell(x.title)} (${mdCell(x.shop)}${variantNote}) | ${money(x.price)} ${ship} | ${ratingText(L, x)} | ${pc.label}${range} | ${mdCell(specText(x, rec.spec_fields, sep)) || '—'} | [${ui(L, 'storeLink')}](${via(x.buy_url, 'md')}) |`,
    );
  }
  out.push('', `## ${ui(L, 'methodTitle')}`, '', rec.method.summary, '');
  out.push(`- ${ui(L, 'formula')}: \`${rec.method.formula}\``);
  out.push(`- ${ui(L, 'why')}: ${rec.method.why}`);
  out.push(`- ${ui(L, 'verdictRule')}: ${rec.method.priceVerdict}`);
  out.push(`- ${ui(L, 'caveat')}: ${rec.method.caveat}`, '');
  out.push(`## ${ui(L, 'machineData')}`, '');
  out.push(`- JSON: ${rec.links.json}`);
  out.push(`- ${ui(L, 'allCategories')}: ${apiUrl(L, 'index.json')}`);
  out.push(`- OpenAPI: ${url('openapi.json')} / ${ui(L, 'mcpServer')}: ${SITE.edge ? url('mcp') : url('mcp/server.mjs')}`);
  out.push(`- ${ui(L, 'languages')}: ${LOCALES.map((X) => `[${X.label}](${rec.languages[X.lang].markdown})`).join(' · ')}`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------- html

function page({ L, title, description, body, canonical, sample, noindex = sample, jsonLd, alternates = [], hreflang = [], root = './' }) {
  const alt = [
    ...alternates.map((a) => `<link rel="alternate" type="${a.type}" href="${esc(a.href)}">`),
    ...hreflang.map((h) => `<link rel="alternate" hreflang="${h.lang}" href="${esc(h.href)}">`),
  ].join('\n');
  const switcher = hreflang
    .filter((h) => h.label)
    .map((h) => (h.lang === L.lang ? `<b>${esc(h.label)}</b>` : `<a href="${esc(h.href)}" hreflang="${h.lang}">${esc(h.label)}</a>`))
    .join(' ');
  return `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${esc(canonical)}">
${alt}
<link rel="stylesheet" href="${root}assets/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="top"><a class="brand" href="${esc(pageUrl(L))}">SHELF</a><span class="tag">${esc(ui(L, 'tagline'))}</span>${switcher ? `<nav class="langs" aria-label="${esc(ui(L, 'languages'))}">${switcher}</nav>` : ''}</header>
${sample ? `<p class="sample">${esc(ui(L, 'sampleBanner'))}</p>` : ''}
<main>
${body}
</main>
<footer>
<p>${esc(L.disclosure.affiliate)}</p>
<p><a href="${esc(SITE.credit.url)}">${esc(SITE.credit.text)}</a> ・ <a href="${esc(pageUrl(L, 'llms.txt'))}">llms.txt</a> ・ <a href="${esc(url('openapi.json'))}">OpenAPI</a> ・ <a href="${esc(aboutUrl(L))}">${esc(ui(L, 'aboutLink'))}</a></p>
</footer>
</body>
</html>
`;
}

// hreflang set for one logical page; x-default is English for the world.
function hreflangs(relOf) {
  return [
    ...LOCALES.map((X) => ({ lang: X.lang, label: X.label, href: relOf(X) })),
    { lang: 'x-default', href: relOf(EN) },
  ];
}

const depthRoot = (L, depth) => '../'.repeat(depth + (L === SOURCE ? 0 : 1));

function categoryHtml(rec, L) {
  const money = L.money;
  const sep = SEP[L.lang] ?? ' · ';
  const pickLabel = { best: ui(L, 'pickBestShort'), budget: ui(L, 'pickBudgetShort'), deal: ui(L, 'pickDealShort') };
  const buy = (x) => esc(via(x.buy_url, 'html'));
  const pickCards = ['best', 'budget', 'deal']
    .filter((k) => rec.picks[k])
    .map((k) => {
      const x = rec.items.find((i) => i.id === rec.picks[k].id);
      return `<article class="pick"><p class="kind">${esc(pickLabel[k])}</p>
${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" width="120" height="120">` : ''}
<h3 lang="ja">${esc(x.title)}</h3>
<p class="price">${money(x.price)} <span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span></p>
<p class="rating">${esc(ratingText(L, x))}</p>
<p class="why">${esc(rec.picks[k].reason)}</p>
<a class="buy" rel="sponsored nofollow noopener" target="_blank" href="${buy(x)}">${esc(ui(L, 'viewOnStore'))}</a></article>`;
    })
    .join('\n');
  const rows = rec.items
    .map(
      (x) => `<tr><td class="c-rank num">${x.rank}</td><td class="c-item"><span lang="ja">${esc(x.title)}</span><br><small lang="ja">${esc(x.shop)}</small><br><small class="specs">${esc(specText(x, rec.spec_fields, sep))}</small></td>
<td class="c-price num">${money(x.price)}<br><small>${esc(x.shipping_included ? ui(L, 'shipIncluded') : ui(L, 'shipExtra'))}</small></td><td class="c-rating num">${esc(ratingText(L, x))}</td>
<td class="c-verdict"><span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span>${x.price_check.median_90d ? `<br><small>${esc(ui(L, 'median', { median: money(x.price_check.median_90d) }))}</small>` : ''}</td>
<td class="c-buy"><a rel="sponsored nofollow noopener" target="_blank" href="${buy(x)}">${esc(ui(L, 'colBuy'))}</a></td></tr>`,
    )
    .join('\n');
  const g = rec.how_to_choose;
  const criteria = g.criteria.map((c) => `<dt>${esc(c.name)}</dt><dd>${esc(c.detail)}</dd>`).join('\n');
  const pitfalls = g.pitfalls.map((p) => `<li>${esc(p)}</li>`).join('');
  const heads = ['colRank', 'colProduct', 'colPrice', 'colRating', 'colPriceCheck'].map((k) => `<th>${esc(ui(L, k))}</th>`).join('');
  const body = `<p class="pr">${esc(ui(L, 'prLabel'))}</p>
<h1>${esc(fill(ui(L, 'pageTitle'), { name: rec.name }))}</h1>
<p class="meta">${esc(ui(L, 'metaLine', { date: rec.data_date ?? '—', count: rec.items.length }))}${rec.status === 'stale' ? `<strong>${esc(ui(L, 'stale'))}</strong>` : ''}</p>
${rec.market.for_visitors ? `<p class="visitor"><strong>${esc(ui(L, 'visitorTitle'))}:</strong> ${esc(rec.market.for_visitors)}</p>` : ''}
<p class="lead">${esc(g.summary)}</p>
<p class="outlook"><strong>${esc(ui(L, 'outlookLabel'))}:</strong> ${esc(rec.price_outlook.summary)}</p>
<section class="picks">${pickCards}</section>
<h2>${esc(ui(L, 'howToChoose'))}</h2><dl class="criteria">${criteria}</dl>
<h3>${esc(ui(L, 'pitfalls'))}</h3><ul>${pitfalls}${g.abroad ? `<li><strong>${esc(ui(L, 'abroadLabel'))}:</strong> ${esc(g.abroad)}</li>` : ''}</ul>
<h2>${esc(ui(L, 'ranking'))}</h2>
<div class="scroll"><table class="rank"><thead><tr>${heads}<th></th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h2>${esc(ui(L, 'methodTitle'))}</h2>
<p>${esc(rec.method.summary)}</p><p><code>${esc(rec.method.formula)}</code></p><p>${esc(rec.method.why)}</p><p><small>${esc(rec.method.caveat)}</small></p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(rec.links.markdown)}">Markdown</a> ・ <a href="${esc(rec.links.json)}">JSON</a></p>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: fill(ui(L, 'pageTitle'), { name: rec.name }),
    inLanguage: L.lang,
    dateModified: rec.updated_at,
    itemListElement: rec.items.map((x) => ({
      '@type': 'ListItem',
      position: x.rank,
      item: {
        '@type': 'Product',
        name: x.title,
        ...(x.image ? { image: x.image } : {}),
        offers: { '@type': 'Offer', price: x.price, priceCurrency: 'JPY', url: x.buy_url, seller: { '@type': 'Organization', name: x.shop } },
      },
    })),
  };
  return page({
    L,
    title: `${fill(ui(L, 'pageTitle'), { name: rec.name })}｜SHELF`,
    description: g.summary,
    canonical: rec.links.html,
    root: depthRoot(L, 2),
    sample: rec.sample,
    jsonLd,
    body,
    alternates: [
      { type: 'text/markdown', href: rec.links.markdown },
      { type: 'application/json', href: rec.links.json },
    ],
    hreflang: hreflangs((X) => rec.languages[X.lang].html),
  });
}

function indexHtml(records, index, L) {
  const cards = records
    .map((r) => {
      const best = r.picks.best;
      return `<li><a href="${esc(r.links.html)}"><strong>${esc(r.name)}</strong></a>
<span>${best ? `${esc(ui(L, 'topPick', { title: best.title, price: L.money(best.price) }))}` : esc(ui(L, 'noData'))}</span>
<small><a href="${esc(r.links.markdown)}">md</a> ・ <a href="${esc(r.links.json)}">json</a></small></li>`;
    })
    .join('\n');
  const body = `<h1>${esc(ui(L, 'indexTitle'))}</h1>
<p class="lead">${ui(L, 'indexLead')}</p>
${L === SOURCE ? '' : `<p class="visitor"><strong>${esc(ui(L, 'visitorTitle'))}:</strong> ${esc(ui(L, 'visitorNote'))}</p>`}
<ul class="cats">${cards}</ul>
<h2>${esc(ui(L, 'agentsTitle'))}</h2>
<ul>
<li><a href="${esc(pageUrl(L, 'llms.txt'))}">llms.txt</a> — ${esc(ui(L, 'llmsDesc'))}</li>
<li><a href="${esc(apiUrl(L, 'index.json'))}">${esc(ui(L, 'apiDesc'))}</a> ・ <a href="${esc(url('openapi.json'))}">OpenAPI</a>${esc(ui(L, 'openapiDesc'))}</li>
<li><a href="${esc(SITE.edge ? url('mcp') : url('mcp/server.mjs'))}">${esc(ui(L, 'mcpDesc'))}</a></li>
<li><a href="${esc(apiUrl(L, 'deals.json'))}">${esc(ui(L, 'dealsDesc'))}</a></li>
</ul>
<p class="meta">${esc(ui(L, 'lastUpdated', { date: index.updated_at ?? '—' }))}</p>`;
  return page({
    L,
    title: `SHELF — ${ui(L, 'tagline')}`,
    description: ui(L, 'indexDescription'),
    canonical: pageUrl(L),
    root: depthRoot(L, 0),
    sample: index.sample,
    body,
    alternates: [{ type: 'text/plain', href: pageUrl(L, 'llms.txt') }],
    hreflang: hreflangs((X) => pageUrl(X)),
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'SHELF', url: pageUrl(L), inLanguage: L.lang, description: ui(L, 'tagline') },
  });
}

const ABOUT = {
  ja: {
    title: 'AIエージェント向け利用方法',
    rulesTitle: '推薦するときのお願い',
    rules: [
      '購入リンク（<code>buy_url</code>）はアフィリエイトリンクです（<code>/go/</code> 経由の場合はクリック数だけを数えて楽天へ転送します。<code>affiliate_url</code> が転送先）。ユーザーに示すときは、その旨を一言添えてください（<code>disclosure</code> フィールドの文面をそのまま使えます）。',
      'スペック（<code>specs</code>）は商品名から自動抽出した参考値です。断定せず「商品名の表記では」と伝えてください。',
      '<code>price_check.verdict</code> が <code>insufficient_data</code> のときは「値下がり中」と言わないでください。',
      '<code>status</code> が <code>stale</code> のカテゴリは価格が古い可能性があります。',
      '<code>variants: true</code> の商品は容量などを選ぶ出品で、価格は最安の選択肢のものかもしれません。',
      '<code>specs.flight_carry_on</code> は目安です。機内持ち込みを答えるときは本体のWh表記と航空会社の最新条件の確認を促してください。',
      '引用するときは <code>citation</code>（URL・データ日付）を添えてください。',
      '日本語以外で答えるときは、各言語版（<code>/en/</code>, <code>/zh-hans/</code>, <code>/zh-hant/</code>, <code>/ko/</code>）を使えます。商品名は楽天の原文（日本語）です。',
    ],
    endpointsTitle: 'エンドポイント',
    endpoints: ['カテゴリ一覧と各カテゴリの1位', '選び方・ランキング・価格判定', '全商品（検索・予算での絞り込み用）', '最近の中央値より安い商品'],
    remote: 'リモートMCP（Streamable HTTP）: <code>{url}</code> — クライアントにこのURLを登録するだけで使えます。',
    local: 'ローカルで動かす場合は、Node.js 18+ があれば依存なしで動きます。',
    tools: 'ツール: <code>list_categories</code>, <code>recommend</code>（予算・スペック絞り込み）, <code>price_outlook</code>（カテゴリの買い時）, <code>search_products</code>, <code>check_price</code>（商品IDまたは楽天の商品URL）。すべて <code>lang</code>（ja / en / zh-Hans / zh-Hant / ko）で回答言語を選べます。',
    description: 'SHELFのAPI・MCPの使い方と推薦時のルール',
  },
  en: {
    title: 'How agents use SHELF',
    rulesTitle: 'When you recommend',
    rules: [
      'Buy links (<code>buy_url</code>) are affiliate links (links through <code>/go/</code> only count the click and forward to Rakuten; <code>affiliate_url</code> is the destination). Say so when you show them; the <code>disclosure</code> field has a ready-made sentence.',
      'Specs (<code>specs</code>) are parsed automatically from product titles. Present them as “according to the listing”, not as fact.',
      'When <code>price_check.verdict</code> is <code>insufficient_data</code>, do not call anything a price drop.',
      'Categories with <code>status</code> <code>stale</code> may have outdated prices.',
      'Items with <code>variants: true</code> let the buyer pick a variant; the price may be for the cheapest option.',
      '<code>specs.flight_carry_on</code> is a guide. When asked about flying, tell the user to check the Wh on the label and the airline’s current rules.',
      'When you cite SHELF, include the <code>citation</code> (URL and data date).',
      'Answer in the user’s language: SHELF is published in Japanese, English, Simplified and Traditional Chinese and Korean (<code>/en/</code>, <code>/zh-hans/</code>, <code>/zh-hant/</code>, <code>/ko/</code>). Product titles are the original Japanese listings. Most shops ship only within Japan, and appliances made for 100 V must not be used on 220–240 V; each non-Japanese record says so in <code>market.for_visitors</code> and <code>how_to_choose.abroad</code>.',
    ],
    endpointsTitle: 'Endpoints',
    endpoints: ['categories with their top pick', 'buying guide, ranking and price verdicts', 'every product (for search and budget filtering)', 'products cheaper than their recent median'],
    remote: 'Remote MCP (Streamable HTTP): <code>{url}</code> — register this URL in your client and it works.',
    local: 'To run it locally, Node.js 18+ is all it needs.',
    tools: 'Tools: <code>list_categories</code>, <code>recommend</code> (budget and spec filters), <code>price_outlook</code> (is now a good time for a category), <code>search_products</code>, <code>check_price</code> (item id or a Rakuten item URL). Every tool takes <code>lang</code> (ja / en / zh-Hans / zh-Hant / ko) for the answer language.',
    description: 'How to use SHELF’s API and MCP server, and the rules for recommending',
  },
};

function aboutHtml(sample, L) {
  const A = ABOUT[L.lang];
  const api = apiUrl(L, '').replace(/\/$/, '');
  const paths = ['index.json', 'c/{category}.json', 'items.json', 'deals.json'];
  const body = `<h1>${esc(A.title)}</h1>
<h2>${esc(A.rulesTitle)}</h2>
<ul>
${A.rules.map((r) => `<li>${r}</li>`).join('\n')}
</ul>
<h2>${esc(A.endpointsTitle)}</h2>
<ul>
${paths.map((p, i) => `<li><code>GET ${esc(api)}/${p}</code> — ${esc(A.endpoints[i])}</li>`).join('\n')}
</ul>
<h2>MCP</h2>
${SITE.edge ? `<p>${fill(A.remote, { url: esc(url('mcp')) })}</p>
<pre>claude mcp add --transport http shelf ${esc(url('mcp'))}</pre>` : ''}
<p>${esc(A.local)}</p>
<pre>curl -o shelf-mcp.mjs ${esc(url('mcp/server.mjs'))}
# claude_desktop_config.json
{ "mcpServers": { "shelf": { "command": "node", "args": ["/path/to/shelf-mcp.mjs"] } } }</pre>
<p>${A.tools}</p>`;
  return page({
    L,
    title: `${A.title}｜SHELF`,
    description: A.description,
    canonical: aboutUrl(L),
    root: depthRoot(L, 1),
    sample,
    body,
    hreflang: [
      { lang: 'ja', label: '日本語', href: url('about/') },
      { lang: 'en', label: 'English', href: url('en/about/') },
      { lang: 'x-default', href: url('en/about/') },
    ],
  });
}

// ---------------------------------------------------------------- discovery

function llmsTxt(records, index, L) {
  const T = L.llms;
  const out = ['# SHELF', ''];
  out.push(`> ${T.summary}${index.sample ? T.sampleWarning : ''}`, '');
  out.push(fill(T.updated, { date: index.updated_at ?? '—', disclosure: index.disclosure }));
  out.push(T.rules);
  if (L !== SOURCE) out.push(ui(L, 'visitorNote'));
  out.push('', `## ${T.categories}`, '');
  for (const r of records) {
    const best = r.picks.best ? ui(L, 'topPick', { title: r.picks.best.title, price: L.money(r.picks.best.price) }) : ui(L, 'noData');
    const summary = r.how_to_choose.summary;
    out.push(`- [${r.name}](${r.links.markdown}): ${best}. ${summary.length > 90 ? `${summary.slice(0, 90)}…` : summary}`);
  }
  out.push('', '## API', '');
  out.push(`- [index.json](${apiUrl(L, 'index.json')}): ${T.index}`);
  out.push(`- [items.json](${apiUrl(L, 'items.json')}): ${T.items}`);
  out.push(`- [deals.json](${apiUrl(L, 'deals.json')}): ${T.deals}`);
  out.push(`- [openapi.json](${url('openapi.json')}): ${T.openapi}`);
  const tools = 'list_categories, recommend, price_outlook, search_products, check_price; lang = ja | en | zh-Hans | zh-Hant | ko';
  if (SITE.edge) out.push(`- [Remote MCP](${url('mcp')}): ${T.remoteMcp} (tools: ${tools})`);
  out.push(`- [MCP server](${url('mcp/server.mjs')}): ${T.localMcp} (tools: ${tools})`);
  out.push('', `## ${T.otherLanguages}`, '');
  for (const X of LOCALES.filter((X) => X !== L)) out.push(`- [${X.label}](${pageUrl(X, 'llms.txt')})`);
  out.push('', '## Optional', '');
  out.push(`- [llms-full.txt](${pageUrl(L, 'llms-full.txt')}): ${T.full}`);
  out.push(`- [${T.about}](${aboutUrl(L)})`, '');
  return out.join('\n');
}

function openApi(records) {
  const ids = records.map((r) => r.id);
  const langs = LOCALES.filter((L) => L !== SOURCE).map((L) => L.slug);
  const obj = (description) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
  const langParam = { name: 'lang', in: 'path', required: true, description: 'Answer language (Japanese is the unprefixed default)', schema: { type: 'string', enum: langs } };
  const catParam = { name: 'category', in: 'path', required: true, schema: { type: 'string', enum: ids } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'SHELF shopping data for AI agents',
      version: '1.1.0',
      description:
        'Buying guides, transparent rankings and daily price history for shopping in Japan (Rakuten Ichiba), in Japanese, English, Simplified and Traditional Chinese and Korean. ' +
        'Static JSON, updated daily. buy_url values are affiliate links: disclose that when showing them to users.',
    },
    servers: [{ url: `${SITE.baseUrl}/api/${SITE.apiVersion}` }],
    paths: {
      '/index.json': { get: { operationId: 'listCategories', summary: 'List categories with their top pick (Japanese)', responses: { 200: obj('Category index') } } },
      '/c/{category}.json': {
        get: { operationId: 'getCategory', summary: 'Buying guide, ranked items, picks and price verdicts for one category (Japanese)', parameters: [catParam], responses: { 200: obj('Category record') } },
      },
      '/items.json': { get: { operationId: 'listItems', summary: 'Every ranked item across categories, compact, for search and budget filtering', responses: { 200: obj('Items') } } },
      '/deals.json': { get: { operationId: 'listDeals', summary: 'Items priced below their recent median', responses: { 200: obj('Deals') } } },
      '/{lang}/index.json': { get: { operationId: 'listCategoriesInLanguage', summary: 'List categories with their top pick, in another language', parameters: [langParam], responses: { 200: obj('Category index') } } },
      '/{lang}/c/{category}.json': {
        get: { operationId: 'getCategoryInLanguage', summary: 'One category, in another language', parameters: [langParam, catParam], responses: { 200: obj('Category record') } },
      },
      '/{lang}/items.json': { get: { operationId: 'listItemsInLanguage', summary: 'Every ranked item, in another language', parameters: [langParam], responses: { 200: obj('Items') } } },
      '/{lang}/deals.json': { get: { operationId: 'listDealsInLanguage', summary: 'Items priced below their recent median, in another language', parameters: [langParam], responses: { 200: obj('Deals') } } },
    },
  };
}

function sitemap(byLocale, date) {
  const urls = [];
  for (const { L, records } of byLocale) {
    urls.push(pageUrl(L), pageUrl(L, 'llms.txt'), ...records.flatMap((r) => [r.links.html, r.links.markdown]));
  }
  urls.push(url('about/'), url('en/about/'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${date}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------- main

function buildLocale(L, state, latestById, buildDate) {
  const records = CATEGORIES.map((c) => categoryRecord(c, latestById[c.id], state, buildDate, L));
  const sample = state.mode !== 'live';
  const index = {
    schema: 'shelf.index/v1',
    lang: L.lang,
    name: SITE.name,
    description: ui(L, 'tagline'),
    sample,
    updated_at: state.updatedAt ?? null,
    disclosure: records[0]?.disclosure ?? L.disclosure.affiliate,
    method: L.method,
    market: records[0]?.market,
    languages: LOCALES.map((X) => ({ lang: X.lang, label: X.label, index: apiUrl(X, 'index.json'), llms: pageUrl(X, 'llms.txt'), home: pageUrl(X) })),
    categories: records.map((r) => ({
      id: r.id,
      name: r.name,
      names: r.names,
      name_en: r.name_en,
      status: r.status,
      translated: r.translated,
      data_date: r.data_date,
      item_count: r.items.length,
      summary: r.how_to_choose.summary,
      best: r.picks.best ?? null,
      links: r.links,
    })),
    endpoints: {
      category: apiUrl(L, 'c/{id}.json'),
      items: apiUrl(L, 'items.json'),
      deals: apiUrl(L, 'deals.json'),
      openapi: url('openapi.json'),
      mcp: url('mcp/server.mjs'),
      ...(SITE.edge ? { mcp_remote: url('mcp') } : {}),
    },
  };

  const allItems = records.flatMap((r) =>
    r.items.map((x) => ({
      id: x.id,
      category: r.id,
      category_name: r.name,
      title: x.title,
      price: x.price,
      rating: x.rating,
      reviews: x.reviews,
      rank: x.rank,
      score: x.score,
      verdict: x.price_check.verdict,
      verdict_label: x.price_check.label,
      median_90d: x.price_check.median_90d,
      shipping_included: x.shipping_included,
      variants: x.variants,
      specs: x.specs,
      buy_url: x.buy_url,
    })),
  );
  const deals = allItems
    .filter((x) => ['lowest_observed', 'below_usual'].includes(x.verdict) && x.median_90d)
    .filter((x) => !x.variants && !records.find((r) => r.id === x.category).items.find((i) => i.id === x.id).price_check.suspicious)
    .map((x) => ({ ...x, drop_pct: Math.round((1 - x.price / x.median_90d) * 1000) / 10 }))
    .sort((a, b) => b.drop_pct - a.drop_pct);

  const meta = { lang: L.lang, sample, updated_at: index.updated_at, disclosure: index.disclosure };
  write(`api/${SITE.apiVersion}/${prefix(L)}index.json`, index);
  write(`api/${SITE.apiVersion}/${prefix(L)}items.json`, { schema: 'shelf.items/v1', ...meta, items: allItems });
  write(`api/${SITE.apiVersion}/${prefix(L)}deals.json`, { schema: 'shelf.deals/v1', ...meta, items: deals });
  const fullParts = [];
  for (const r of records) {
    write(`api/${SITE.apiVersion}/${prefix(L)}c/${r.id}.json`, r);
    const md = categoryMarkdown(r, L);
    fullParts.push(md);
    write(`${prefix(L)}c/${r.id}.md`, md);
    write(`${prefix(L)}c/${r.id}/index.html`, categoryHtml(r, L));
  }
  write(`${prefix(L)}index.html`, indexHtml(records, index, L));
  if (ABOUT[L.lang]) write(`${prefix(L)}about/index.html`, aboutHtml(sample, L));
  write(`${prefix(L)}llms.txt`, llmsTxt(records, index, L));
  write(`${prefix(L)}llms-full.txt`, [llmsTxt(records, index, L), ...fullParts].join('\n\n---\n\n'));
  return { L, records, index };
}

export function build({ now = new Date() } = {}) {
  const state = readJson(path.join(DATA_DIR, 'state.json'), { mode: 'sample', categories: {} });
  const buildDate = todayJst(now);
  const latestById = Object.fromEntries(CATEGORIES.map((c) => [c.id, readJson(path.join(DATA_DIR, 'latest', `${c.id}.json`), null)]));

  for (const dir of ['c', 'api', 'about', ...LOCALES.filter((L) => L !== SOURCE).map((L) => L.slug)]) {
    fs.rmSync(path.join(OUT_DIR, dir), { recursive: true, force: true });
  }
  const byLocale = LOCALES.map((L) => buildLocale(L, state, latestById, buildDate));
  const { records, index } = byLocale[0];

  write('openapi.json', openApi(records));
  write('sitemap.xml', sitemap(byLocale, buildDate));
  // Only takes effect at a domain root (the Cloudflare deployment).
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n`);
  const home = LOCALES.map((X) => `<a href="${esc(pageUrl(X))}" hreflang="${X.lang}">${esc(X.label)}</a>`).join(' ・ ');
  write(
    '404.html',
    page({
      L: SOURCE,
      title: 'Not found｜SHELF',
      description: 'SHELF',
      canonical: `${SITE.baseUrl}/`,
      noindex: true,
      root: `${new URL(SITE.baseUrl).pathname.replace(/\/$/, '')}/`,
      body: `<h1>ページが見つかりません / Page not found</h1><p>${home}</p><p><a href="${esc(url('llms.txt'))}">llms.txt</a></p>`,
    }),
  );
  return { records, index, byLocale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { byLocale } = build();
  console.log(`built ${byLocale[0].records.length} categories × ${byLocale.length} languages into ${OUT_DIR}`);
}
