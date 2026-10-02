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
import { saleCheck, activeEvents, SALE_VERDICTS } from './sale.mjs';
import { atomFeed, dealEntries } from './feeds.mjs';
import { COMPAT_RULES } from './compat.mjs';
import { AREAS, nightTrend } from './hotels.mjs';
import { SERIES, TEXT as BOOKS_TEXT, icsCalendar, parseSalesDate } from './books.mjs';

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
  feed: pageUrl(L, `c/${id}/feed.xml`),
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

// Stores whose data a record shows (main listings and other offers).
function storesIn(items) {
  const set = new Set(['rakuten']);
  for (const x of items) {
    set.add(x.store || 'rakuten');
    for (const o of x.other_offers || []) set.add(o.store || 'rakuten');
  }
  return [...set];
}

function publicItem(item, categoryId, L, unitLabel) {
  const link = (id, direct) => (SITE.edge ? goUrl(categoryId, id, 'api', L.slug) : direct);
  const ps = item.priceStats || {};
  const allOffers = (item.otherOffers || []).map((o) => ({ id: o.id, store: o.store || 'rakuten', store_name: ui(L, `store_${o.store || 'rakuten'}`), shop: o.shop, price: o.price, shipping_included: o.shippingIncluded ?? null, buy_url: link(o.id, o.buyUrl), affiliate_url: o.buyUrl }));
  const offers = allOffers.slice(0, 3);
  // Another store's listing of the same product can be cheaper: say so. The
  // main link stays the best-rated listing; the choice is the buyer's.
  // Searched over every offer: the cheapest shipping-included one may not be
  // among the three cheapest listed.
  const cheaper = allOffers.filter((o) => o.price < item.price && (o.shipping_included || !item.shippingIncluded)).sort((a, b) => a.price - b.price)[0];
  return {
    id: item.id,
    rank: item.rank,
    title: item.title,
    name: item.name,
    store: item.source === 'yahoo' ? 'yahoo' : 'rakuten',
    store_name: ui(L, `store_${item.source === 'yahoo' ? 'yahoo' : 'rakuten'}`),
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
    ...(item.unit ? { unit_price: { value: item.unit.value, label: unitLabel, quantity: item.unit.quantity } } : {}),
    ...(saleOf(item, L) ? { sale_check: saleOf(item, L) } : {}),
    specs: item.facets || {},
    buy_url: link(item.id, item.buyUrl),
    affiliate_url: item.buyUrl,
    affiliate: Boolean(item.affiliate),
    product_url: item.productUrl,
    image: item.image,
    other_offers: offers,
    ...(cheaper ? { cheapest_offer: cheaper } : {}),
  };
}

function saleOf(item, L) {
  const sc = saleCheck(item);
  return sc ? { ...sc, label: ui(L, `sale_${sc.verdict}`) } : null;
}

// Weekly category price index: for each week, the median over ranked items
// of (that week's lowest price ÷ the item's usual price). 100 = usual.
export function priceIndex(items) {
  const byWeek = new Map();
  for (const x of items) {
    const usual = x.price_check.median_90d;
    if (!usual) continue;
    for (const [week, p] of x.price_check.weekly_low || []) {
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week).push(p / usual);
    }
  }
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return [...byWeek.entries()]
    .filter(([, r]) => r.length >= 3)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, r]) => ({ week_end: week, index: Math.round(med(r) * 1000) / 10, items: r.length }));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

// Short, self-contained sentences with numbers and a date: what answer
// engines quote. Each repeats the category name so it stands alone.
function factsAndFaq(rec, L) {
  const date = rec.data_date ?? '—';
  const name = rec.name;
  const prices = rec.items.map((x) => x.price);
  const best = rec.picks.best && rec.items.find((x) => x.id === rec.picks.best.id);
  const unitPick = rec.picks.per_unit && rec.items.find((x) => x.id === rec.picks.per_unit.id);
  const idx = rec.price_index;
  const last = idx.at(-1);
  const prev = idx.length > 4 ? idx.at(-5) : idx[0];
  const v = (x) => (rec.unit_rule?.higher_is_better ? `${x.unit_price.value.toLocaleString(L.numberLocale)}` : L.money(x.unit_price.value));
  const facts = [];
  const faq = [];
  if (prices.length) {
    facts.push(ui(L, 'fact_tracked', { name, count: prices.length }));
    facts.push(ui(L, 'fact_price', { median: L.money(median(prices)), min: L.money(Math.min(...prices)), max: L.money(Math.max(...prices)) }));
  }
  if (best) facts.push(ui(L, 'fact_best', { title: best.title, price: L.money(best.price), rating: best.rating.toFixed(2), reviews: best.reviews.toLocaleString(L.numberLocale) }));
  if (unitPick) facts.push(ui(L, 'fact_unit', { unit: rec.unit_rule.label, title: unitPick.title, value: v(unitPick) }));
  if (last && prev && prev !== last) facts.push(ui(L, 'fact_index', { name, index: last.index, prev: prev.index, weeks: idx.length > 4 ? 4 : idx.length - 1 }));
  if (best) faq.push({ q: ui(L, 'q_best', { name }), a: ui(L, 'a_best', { date, name, title: best.title, price: L.money(best.price), rating: best.rating.toFixed(2), reviews: best.reviews.toLocaleString(L.numberLocale) }) });
  if (prices.length) faq.push({ q: ui(L, 'q_price', { name }), a: ui(L, 'a_price', { date, name, count: prices.length, median: L.money(median(prices)), min: L.money(Math.min(...prices)), max: L.money(Math.max(...prices)) }) });
  faq.push({ q: ui(L, 'q_timing', { name }), a: ui(L, 'a_timing', { date, name, outlook: rec.price_outlook.summary }) });
  if (unitPick) {
    const more = rec.unit_rule.higher_is_better;
    faq.push({ q: ui(L, more ? 'q_unit_more' : 'q_unit', { name, unit: rec.unit_rule.label }), a: ui(L, more ? 'a_unit_more' : 'a_unit', { date, name, unit: rec.unit_rule.label, title: unitPick.title, value: v(unitPick) }) });
  }
  faq.push({ q: ui(L, 'q_how', { name }), a: rec.how_to_choose.summary });
  return { facts, faq };
}

const monthLabel = (L, date) => (date ? new Intl.DateTimeFormat(L.numberLocale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : '');

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
  const spec = category.unitPrice;
  const items = (latest?.items || []).map((x) => publicItem(x, category.id, L, loc.unitLabel));
  const reasons = {
    best: ui(L, 'reasonBest'),
    budget: ui(L, 'reasonBudget'),
    deal: ui(L, 'reasonDeal'),
    per_unit: ui(L, spec?.perYen ? 'reasonPerYen' : 'reasonPerUnit', { unit: loc.unitLabel }),
  };
  const picks = {};
  for (const [kind, id] of Object.entries(latest?.picks || {})) {
    const item = items.find((x) => x.id === id);
    if (item) picks[kind] = { id, reason: reasons[kind], title: item.title, price: item.price, buy_url: item.buy_url };
  }
  const disclosure = disclosureFor(sample, items, L);
  const l = links(category.id, L);
  const rec = {
    schema: 'shelf.category/v1',
    lang: L.lang,
    translated: loc.translated,
    id: category.id,
    name: loc.name,
    name_ja: category.name,
    name_en: englishName(category),
    names: Object.fromEntries(LOCALES.filter((X) => !category.langs || category.langs.includes(X.lang)).map((X) => [X.lang, localizeCategory(category, X).name])),
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
    market: { country: 'JP', currency: 'JPY', store: storesIn(items).map((st) => (st === 'yahoo' ? 'Yahoo! Shopping' : 'Rakuten Ichiba')).join(', '), ...(L === SOURCE ? {} : { for_visitors: ui(L, 'visitorNote') }) },
    how_to_choose: loc.guide,
    price_outlook: priceOutlook(items, L),
    method: L.method,
    spec_fields: specFields(category, loc),
    ...(spec
      ? {
          unit_rule: { label: loc.unitLabel, higher_is_better: Boolean(spec.perYen), note: ui(L, spec.perYen ? 'unitNoteDonation' : 'unitNote') },
          unit_ranking: items
            .filter((x) => x.unit_price)
            .sort((a, b) => (spec.perYen ? b.unit_price.value - a.unit_price.value : a.unit_price.value - b.unit_price.value))
            .map((x) => x.id),
        }
      : {}),
    picks,
    items,
    price_index: priceIndex(items),
    stats: latest?.stats ?? null,
    links: l,
    languages: Object.fromEntries(LOCALES.filter((X) => !category.langs || category.langs.includes(X.lang)).map((X) => [X.lang, links(category.id, X)])),
    source: { name: 'Rakuten Ichiba', credit: SITE.credit },
    sources: storesIn(items).map((st) => (st === 'yahoo' ? { name: 'Yahoo! Shopping', credit: SITE.yahooCredit } : { name: 'Rakuten Ichiba', credit: SITE.credit })),
  };
  const { facts, faq } = factsAndFaq(rec, L);
  return { ...rec, key_facts: facts, faq, license: ui(L, 'licenseText') };
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

// "1kgあたり ¥311", or for furusato "寄附1万円あたり(kg) 7.5".
function unitText(L, rec, x) {
  if (!x.unit_price) return '';
  const v = rec.unit_rule.higher_is_better ? x.unit_price.value.toLocaleString(L.numberLocale) : L.money(x.unit_price.value);
  return `${x.unit_price.label} ${v}`;
}

const PICK_KINDS = ['best', 'budget', 'deal', 'per_unit'];
const pickLabels = (L, short) => ({
  best: ui(L, short ? 'pickBestShort' : 'pickBest'),
  budget: ui(L, short ? 'pickBudgetShort' : 'pickBudget'),
  deal: ui(L, short ? 'pickDealShort' : 'pickDeal'),
  per_unit: ui(L, short ? 'pickPerUnitShort' : 'pickPerUnit'),
});
const saleBadge = (x) => (x.sale_check ? ` / ${x.sale_check.label}` : '');

const SEP = { ja: '・', en: ' · ', 'zh-Hans': '、', 'zh-Hant': '、', ko: ' · ' };
const ratingText = (L, x) => ui(L, 'rating', { rating: x.rating.toFixed(2), reviews: x.reviews.toLocaleString(L.numberLocale) });

// ---------------------------------------------------------------- markdown

export function categoryMarkdown(rec, L = SOURCE) {
  const money = L.money;
  const sep = SEP[L.lang] ?? ' · ';
  const out = [];
  out.push(`# ${fill(ui(L, 'pageTitle'), { name: rec.name })} — SHELF`, '');
  out.push(`> ${rec.disclosure}`);
  out.push(`> ${ui(L, 'dataLine', { date: rec.data_date ?? '—', status: rec.status, credit: rec.sources.map((x) => x.credit.text).join(' / ') })}`, '');
  if (rec.sample) out.push(ui(L, 'sampleNotice'), '');
  if (rec.market.for_visitors) out.push(`> **${ui(L, 'visitorTitle')}**: ${rec.market.for_visitors}`, '');
  out.push(`## ${ui(L, 'factsTitle', { date: rec.data_date ?? '—' })}`, '');
  for (const f of rec.key_facts) out.push(`- ${f}`);
  out.push('', `## ${ui(L, 'faqTitle')}`, '');
  for (const { q, a } of rec.faq) out.push(`### ${q}`, '', a, '');
  out.push(`## ${ui(L, 'bottomLine')}`, '');
  const pickLabel = pickLabels(L, false);
  for (const kind of PICK_KINDS) {
    const p = rec.picks[kind];
    if (!p) continue;
    const item = rec.items.find((x) => x.id === p.id);
    const unit = kind === 'per_unit' ? ` (${unitText(L, rec, item)})` : '';
    out.push(`- **${pickLabel[kind]}**: ${item.title} — ${money(item.price)}${unit} ${ratingText(L, item)}, ${ui(L, 'priceCheck')}: ${item.price_check.label}${saleBadge(item)} → [${ui(L, 'buyLink')}](${via(item.buy_url, 'md')})`);
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
      `| ${x.rank} | ${mdCell(x.title)} (${mdCell(x.shop)}${variantNote}) | ${money(x.price)} ${ship} | ${ratingText(L, x)} | ${pc.label}${range}${mdCell(saleBadge(x))} | ${mdCell(specText(x, rec.spec_fields, sep)) || '—'} | [${x.store_name}](${via(x.buy_url, 'md')})${x.cheapest_offer ? ` · [${ui(L, 'cheaperAt', { store: x.cheapest_offer.store_name, price: money(x.cheapest_offer.price) })}](${via(x.cheapest_offer.buy_url, 'md')})` : ''} |`,
    );
  }
  if (rec.unit_ranking?.length) {
    out.push('', `## ${ui(L, rec.unit_rule.higher_is_better ? 'unitRankingMore' : 'unitRanking', { unit: rec.unit_rule.label })}`, '', rec.unit_rule.note, '');
    out.push(`| # | ${ui(L, 'colProduct')} | ${ui(L, rec.unit_rule.higher_is_better ? 'colDonation' : 'colPrice')} | ${rec.unit_rule.label} | ${ui(L, 'colRating')} | ${ui(L, 'colBuy')} |`);
    out.push('| --- | --- | --- | --- | --- | --- |');
    rec.unit_ranking.slice(0, 10).forEach((id, i) => {
      const x = rec.items.find((it) => it.id === id);
      const ship = x.shipping_included ? ui(L, 'shipIncluded') : ui(L, 'shipExtra');
      const v = rec.unit_rule.higher_is_better ? x.unit_price.value.toLocaleString(L.numberLocale) : money(x.unit_price.value);
      out.push(`| ${i + 1} | ${mdCell(x.title)} | ${money(x.price)} ${ship} | ${v} | ${ratingText(L, x)} | [${x.store_name}](${via(x.buy_url, 'md')}) |`);
    });
  }
  if (rec.price_index.length >= 2) {
    out.push('', `## ${ui(L, 'priceIndexTitle', { name: rec.name })}`, '', ui(L, 'priceIndexNote'), '');
    out.push(`| ${ui(L, 'colWeek')} | ${ui(L, 'colIndex')} | ${ui(L, 'colItems')} |`, '| --- | --- | --- |');
    for (const w of rec.price_index.slice(-8)) out.push(`| ${w.week_end} | ${w.index} | ${w.items} |`);
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
  out.push(`- ${ui(L, 'languages')}: ${LOCALES.filter((X) => rec.languages[X.lang]).map((X) => `[${X.label}](${rec.languages[X.lang].markdown})`).join(' · ')}`, '');
  out.push(`## ${ui(L, 'citeTitle')}`, '', ui(L, 'citeText', { title: rec.citation.title, date: rec.data_date ?? '—', url: rec.citation.url }), '', rec.license, '');
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
${[jsonLd].flat().filter(Boolean).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="top"><a class="brand" href="${esc(pageUrl(L))}">SHELF</a><span class="tag">${esc(ui(L, 'tagline'))}</span>${switcher ? `<nav class="langs" aria-label="${esc(ui(L, 'languages'))}">${switcher}</nav>` : ''}</header>
${sample ? `<p class="sample">${esc(ui(L, 'sampleBanner'))}</p>` : ''}
<main>
${body}
</main>
<footer>
<p>${esc(L.disclosure.affiliate)}</p>
<p><a href="${esc(SITE.credit.url)}">${esc(SITE.credit.text)}</a> ・ <span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">${L === SOURCE ? 'Webサービス by Yahoo! JAPAN' : 'Web Services by Yahoo! JAPAN'}</a></span> ・ <a href="${esc(pageUrl(L, 'llms.txt'))}">llms.txt</a> ・ <a href="${esc(url('openapi.json'))}">OpenAPI</a> ・ <a href="${esc(aboutUrl(L))}">${esc(ui(L, 'aboutLink'))}</a></p>
</footer>
</body>
</html>
`;
}

// hreflang set for one logical page; x-default is English for the world.
function hreflangs(relOf) {
  return [
    ...LOCALES.map((X) => ({ lang: X.lang, label: X.label, href: relOf(X) })),
    { lang: 'x-default', href: relOf(EN) ?? relOf(SOURCE) },
  ];
}

function priceIndexHtml(rec, L) {
  if (rec.price_index.length < 2) return '';
  const rows = rec.price_index.slice(-8);
  const max = Math.max(...rows.map((w) => w.index), 110);
  const min = Math.min(...rows.map((w) => w.index), 90);
  const bar = (v) => Math.round(((v - min) / (max - min || 1)) * 100);
  return `<h2>${esc(ui(L, 'priceIndexTitle', { name: rec.name }))}</h2>
<p><small>${esc(ui(L, 'priceIndexNote'))}</small></p>
<table class="pindex"><thead><tr><th>${esc(ui(L, 'colWeek'))}</th><th>${esc(ui(L, 'colIndex'))}</th><th></th></tr></thead><tbody>
${rows.map((w) => `<tr><td>${esc(w.week_end)}</td><td class="num">${w.index}</td><td><span class="bar" style="width:${Math.max(2, bar(w.index))}%"></span></td></tr>`).join('\n')}
</tbody></table>`;
}

function unitTableHtml(rec, L) {
  if (!rec.unit_ranking?.length) return '';
  const rows = rec.unit_ranking
    .slice(0, 10)
    .map((id, i) => {
      const x = rec.items.find((it) => it.id === id);
      return `<tr><td class="c-rank num">${i + 1}</td><td class="c-item"><span lang="ja">${esc(x.title)}</span></td><td class="c-price num">${L.money(x.price)}<br><small>${esc(x.shipping_included ? ui(L, 'shipIncluded') : ui(L, 'shipExtra'))}</small></td><td class="c-rating num"><strong>${esc(unitText(L, rec, x))}</strong></td><td class="c-verdict">${esc(ratingText(L, x))}</td><td class="c-buy"><a rel="sponsored nofollow noopener" target="_blank" href="${esc(via(x.buy_url, 'html'))}">${esc(ui(L, 'colBuy'))}</a></td></tr>`;
    })
    .join('\n');
  return `<h2>${esc(ui(L, rec.unit_rule.higher_is_better ? 'unitRankingMore' : 'unitRanking', { unit: rec.unit_rule.label }))}</h2>
<p><small>${esc(rec.unit_rule.note)}</small></p>
<div class="scroll"><table class="rank"><thead><tr><th>#</th><th>${esc(ui(L, 'colProduct'))}</th><th>${esc(ui(L, rec.unit_rule.higher_is_better ? 'colDonation' : 'colPrice'))}</th><th>${esc(rec.unit_rule.label)}</th><th>${esc(ui(L, 'colRating'))}</th><th></th></tr></thead><tbody>
${rows}
</tbody></table></div>`;
}

const depthRoot = (L, depth) => '../'.repeat(depth + (L === SOURCE ? 0 : 1));

function categoryHtml(rec, L) {
  const money = L.money;
  const sep = SEP[L.lang] ?? ' · ';
  const pickLabel = pickLabels(L, true);
  const buy = (x) => esc(via(x.buy_url, 'html'));
  const pickCards = PICK_KINDS
    .filter((k) => rec.picks[k])
    .map((k) => {
      const x = rec.items.find((i) => i.id === rec.picks[k].id);
      return `<article class="pick"><p class="kind">${esc(pickLabel[k])}</p>
${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" width="120" height="120">` : ''}
<h3 lang="ja">${esc(x.title)}</h3>
<p class="price">${money(x.price)} <span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span></p>
${k === 'per_unit' ? `<p class="unit">${esc(unitText(L, rec, x))}</p>` : ''}${x.sale_check ? `<p><span class="sale s-${esc(x.sale_check.verdict)}">${esc(x.sale_check.label)}</span></p>` : ''}
<p class="rating">${esc(ratingText(L, x))}</p>
<p class="why">${esc(rec.picks[k].reason)}</p>
<a class="buy" rel="sponsored nofollow noopener" target="_blank" href="${buy(x)}">${esc(ui(L, 'viewOnStore', { store: x.store_name }))}</a>${x.cheapest_offer ? `<a class="alt" rel="sponsored nofollow noopener" target="_blank" href="${esc(via(x.cheapest_offer.buy_url, 'html'))}">${esc(ui(L, 'cheaperAt', { store: x.cheapest_offer.store_name, price: money(x.cheapest_offer.price) }))}</a>` : ''}</article>`;
    })
    .join('\n');
  const rows = rec.items
    .map(
      (x) => `<tr><td class="c-rank num">${x.rank}</td><td class="c-item"><span lang="ja">${esc(x.title)}</span><br><small lang="ja">${esc(x.shop)}</small><br><small class="specs">${esc(specText(x, rec.spec_fields, sep))}</small></td>
<td class="c-price num">${money(x.price)}<br><small>${esc(x.shipping_included ? ui(L, 'shipIncluded') : ui(L, 'shipExtra'))}</small></td><td class="c-rating num">${esc(ratingText(L, x))}</td>
<td class="c-verdict"><span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span>${x.price_check.median_90d ? `<br><small>${esc(ui(L, 'median', { median: money(x.price_check.median_90d) }))}</small>` : ''}${x.sale_check ? `<br><span class="sale s-${esc(x.sale_check.verdict)}">${esc(x.sale_check.label)}</span>` : ''}${x.unit_price ? `<br><small>${esc(unitText(L, rec, x))}</small>` : ''}</td>
<td class="c-buy"><a rel="sponsored nofollow noopener" target="_blank" href="${buy(x)}">${esc(x.store_name)}</a>${x.cheapest_offer ? `<br><small><a rel="sponsored nofollow noopener" target="_blank" href="${esc(via(x.cheapest_offer.buy_url, 'html'))}">${esc(ui(L, 'cheaperAt', { store: x.cheapest_offer.store_name, price: money(x.cheapest_offer.price) }))}</a></small>` : ''}</td></tr>`,
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
<section class="facts"><h2>${esc(ui(L, 'factsTitle', { date: rec.data_date ?? '—' }))}</h2><ul>${rec.key_facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>
<p class="lead">${esc(g.summary)}</p>
<p class="outlook"><strong>${esc(ui(L, 'outlookLabel'))}:</strong> ${esc(rec.price_outlook.summary)}</p>
<section class="picks">${pickCards}</section>
<h2>${esc(ui(L, 'howToChoose'))}</h2><dl class="criteria">${criteria}</dl>
<h3>${esc(ui(L, 'pitfalls'))}</h3><ul>${pitfalls}${g.abroad ? `<li><strong>${esc(ui(L, 'abroadLabel'))}:</strong> ${esc(g.abroad)}</li>` : ''}</ul>
<h2>${esc(ui(L, 'ranking'))}</h2>
<div class="scroll"><table class="rank"><thead><tr>${heads}<th></th></tr></thead><tbody>
${rows}
</tbody></table></div>
${unitTableHtml(rec, L)}
${priceIndexHtml(rec, L)}
<h2>${esc(ui(L, 'faqTitle'))}</h2>
<div class="faq">${rec.faq.map(({ q, a }) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}</div>
<h2>${esc(ui(L, 'methodTitle'))}</h2>
<p>${esc(rec.method.summary)}</p><p><code>${esc(rec.method.formula)}</code></p><p>${esc(rec.method.why)}</p><p><small>${esc(rec.method.caveat)}</small></p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(rec.links.markdown)}">Markdown</a> ・ <a href="${esc(rec.links.json)}">JSON</a> ・ <a href="${esc(rec.links.feed)}">Atom</a></p>
<aside class="cite"><h2>${esc(ui(L, 'citeTitle'))}</h2><p><code>${esc(ui(L, 'citeText', { title: rec.citation.title, date: rec.data_date ?? '—', url: rec.citation.url }))}</code></p><p><small>${esc(rec.license)}</small></p></aside>`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: L.lang, mainEntity: rec.faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
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
    title: `${ui(L, 'titleDated', { title: fill(ui(L, 'pageTitle'), { name: rec.name }), month: monthLabel(L, rec.data_date) })}｜SHELF`,
    description: rec.key_facts.slice(0, 2).join(' ') || g.summary,
    canonical: rec.links.html,
    root: depthRoot(L, 2),
    sample: rec.sample,
    jsonLd: [jsonLd, faqLd],
    body,
    alternates: [
      { type: 'text/markdown', href: rec.links.markdown },
      { type: 'application/json', href: rec.links.json },
      { type: 'application/atom+xml', href: rec.links.feed },
    ],
    hreflang: hreflangs((X) => rec.languages[X.lang]?.html).filter((h) => h.href),
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
<li><a href="${esc(apiUrl(L, 'deals.json'))}">${esc(ui(L, 'dealsDesc'))}</a> ・ <a href="${esc(pageUrl(L, 'deals.xml'))}">Atom</a></li>
<li><a href="${esc(pageUrl(L, 'sale/'))}">${esc(ui(L, 'saleTitle'))}</a></li>
<li><a href="${esc(pageUrl(L, 'compat/'))}">${esc(ui(L, 'compatTitle'))}</a></li>
<li><a href="${esc(pageUrl(L, 'hotels/'))}">${esc(ui(L, 'hotelsTitle'))}</a></li>${L === SOURCE ? `\n<li><a href="${esc(url('books/'))}">${esc(BOOKS_TEXT.title)}</a></li>` : ''}
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
    alternates: [
      { type: 'text/plain', href: pageUrl(L, 'llms.txt') },
      { type: 'application/atom+xml', href: pageUrl(L, 'deals.xml') },
    ],
    hreflang: hreflangs((X) => pageUrl(X)),
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'SHELF', url: pageUrl(L), inLanguage: L.lang, description: ui(L, 'tagline'), publisher: { '@type': 'Organization', name: 'SHELF', url: `${SITE.baseUrl}/` } },
      {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: `SHELF — ${ui(L, 'datasetName')}`,
        description: ui(L, 'datasetDescription'),
        url: pageUrl(L),
        inLanguage: L.lang,
        license: 'https://creativecommons.org/licenses/by/4.0/',
        creator: { '@type': 'Organization', name: 'SHELF', url: `${SITE.baseUrl}/` },
        isAccessibleForFree: true,
        dateModified: index.updated_at,
        temporalCoverage: `${records.map((r) => r.price_index[0]?.week_end).filter(Boolean).sort()[0] ?? index.updated_at?.slice(0, 10)}/..`,
        spatialCoverage: 'JP',
        keywords: records.map((r) => r.name),
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: apiUrl(L, 'index.json') },
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: apiUrl(L, 'items.json') },
          { '@type': 'DataDownload', encodingFormat: 'text/markdown', contentUrl: pageUrl(L, 'llms-full.txt') },
        ],
      },
    ],
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
    policyTitle: '編集方針',
    policy: [
      '独立性: 順位とおすすめは公開した計算式だけで決まり、紹介料の率・広告費・ストアからの依頼は一切反映しない。',
      'データ源: 楽天市場・Yahoo!ショッピング・楽天トラベル・楽天ブックスの公式API。毎日05:17（日本時間）に自動更新。',
      '選び方ガイド: 一般に確認できる事実だけで書き、基準日（asOf）を明記。6か月ごとに見直す。',
      '訂正: 誤りは GitHub の Issue（https://github.com/bufeks/LAB/issues）で受け付け、確認後に修正する。',
      'ライセンス: SHELF が作成した文章と統計は CC BY 4.0（出典の明記で引用・転載可）。商品名・価格・画像は各ストアのもの。',
    ],
    endpointsTitle: 'エンドポイント',
    endpoints: ['カテゴリ一覧と各カテゴリの1位', '選び方・ランキング・価格判定', '全商品（検索・予算での絞り込み用）', '最近の中央値より安い商品'],
    remote: 'リモートMCP（Streamable HTTP）: <code>{url}</code> — クライアントにこのURLを登録するだけで使えます。',
    local: 'ローカルで動かす場合は、Node.js 18+ があれば依存なしで動きます。',
    tools: 'ツール: <code>list_categories</code>, <code>recommend</code>（予算・スペック絞り込み、<code>sort: unit_price</code> で単価順）, <code>price_outlook</code>（カテゴリの買い時）, <code>search_products</code>, <code>check_price</code>（商品IDまたは楽天の商品URL）, <code>check_compatibility</code>（替えブラシの互換）, <code>sale_check</code>（セール表示の真偽）, <code>hotel_outlook</code>（ホテル料金の買い時）, <code>upcoming_releases</code>（新刊の発売日）。すべて <code>lang</code>（ja / en / zh-Hans / zh-Hant / ko）で回答言語を選べます。',
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
    policyTitle: 'Editorial policy',
    policy: [
      'Independence: rankings and picks come only from the published formulas; commission rates, ad money and store requests play no part.',
      'Sources: the official APIs of Rakuten Ichiba, Yahoo! Shopping, Rakuten Travel and Rakuten Books, updated automatically every day at 05:17 JST.',
      'Buying guides: written from generally verifiable facts, with an as-of date, and reviewed every six months.',
      'Corrections: report errors as GitHub issues (https://github.com/bufeks/LAB/issues); they are fixed once confirmed.',
      'License: text and statistics written by SHELF are CC BY 4.0 (reuse with credit). Product names, prices and images belong to the stores.',
    ],
    endpointsTitle: 'Endpoints',
    endpoints: ['categories with their top pick', 'buying guide, ranking and price verdicts', 'every product (for search and budget filtering)', 'products cheaper than their recent median'],
    remote: 'Remote MCP (Streamable HTTP): <code>{url}</code> — register this URL in your client and it works.',
    local: 'To run it locally, Node.js 18+ is all it needs.',
    tools: 'Tools: <code>list_categories</code>, <code>recommend</code> (budget and spec filters; <code>sort: unit_price</code> for consumables), <code>price_outlook</code> (is now a good time for a category), <code>search_products</code>, <code>check_price</code> (item id or a Rakuten item URL), <code>check_compatibility</code> (brush heads), <code>sale_check</code> (are sale claims real), <code>hotel_outlook</code> (book now or wait), <code>upcoming_releases</code> (manga release dates). Every tool takes <code>lang</code> (ja / en / zh-Hans / zh-Hant / ko) for the answer language.',
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
<h2>${esc(A.policyTitle)}</h2>
<ul>
${A.policy.map((r) => `<li>${esc(r)}</li>`).join('\n')}
</ul>
<h2>${esc(A.endpointsTitle)}</h2>
<ul>
${paths.map((p, i) => `<li><code>GET ${esc(api)}/${p}</code> — ${esc(A.endpoints[i])}</li>`).join('\n')}
</ul>
<h2>MCP</h2>
${SITE.edge ? `<p>${fill(A.remote, { url: esc(url('mcp')) })}</p>
<pre>claude mcp add --transport http shelf ${esc(url('mcp'))}</pre>` : ''}
<p>${esc(A.local)}</p>
<p>${L === SOURCE ? '値下がりを追う個人用フィード（登録不要・個人情報なし）' : 'Personal price watch feed (no account, nothing stored)'}: <code>${esc(url('feed/watch.xml'))}?ids=&lt;id1&gt;,&lt;id2&gt;&amp;below=&lt;yen&gt;&amp;lang=${L === SOURCE ? 'ja' : 'en'}</code>${SITE.edge ? '' : (L === SOURCE ? '（独自ドメイン版のみ）' : ' (custom-domain deployment only)')}</p>
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
    const facts = r.key_facts.slice(1, 2).join(' ');
    out.push(`- [${r.name}](${r.links.markdown}): ${best}. ${facts} ${r.price_outlook.summary.split(/[。.]/)[0]}.`);
  }
  out.push('', '## API', '');
  out.push(`- [index.json](${apiUrl(L, 'index.json')}): ${T.index}`);
  out.push(`- [items.json](${apiUrl(L, 'items.json')}): ${T.items}`);
  out.push(`- [deals.json](${apiUrl(L, 'deals.json')}): ${T.deals}`);
  out.push(`- [deals.xml](${pageUrl(L, 'deals.xml')}): ${ui(L, 'feedTitle')} (Atom)`);
  out.push(`- [sale.json](${apiUrl(L, 'sale.json')}): ${ui(L, 'saleLead')}`);
  out.push(`- [compat.json](${apiUrl(L, 'compat.json')}): ${ui(L, 'compatLead')}`);
  out.push(`- [hotels.md](${pageUrl(L, 'hotels.md')}) / [hotels.json](${apiUrl(L, 'hotels.json')}): ${ui(L, 'hotelsLead')}`);
  if (L === SOURCE) out.push(`- [books.json](${url(`api/${SITE.apiVersion}/books.json`)}) / [books.ics](${url('books.ics')}): ${BOOKS_TEXT.lead}`);
  out.push(`- [openapi.json](${url('openapi.json')}): ${T.openapi}`);
  const tools = 'list_categories, recommend, price_outlook, search_products, check_price, check_compatibility, sale_check, hotel_outlook, upcoming_releases; lang = ja | en | zh-Hans | zh-Hant | ko';
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
      version: '1.2.0',
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
      '/sale.json': { get: { operationId: 'saleCheck', summary: 'Discount claims in listing titles checked against each item’s recorded prices, plus shopping events today', responses: { 200: obj('Sale check') } } },
      '/compat.json': { get: { operationId: 'brushHeadCompatibility', summary: 'Manufacturer-stated rules for which brush heads fit which electric toothbrush handles', responses: { 200: obj('Compatibility rules') } } },
      '/hotels.json': { get: { operationId: 'hotelOutlook', summary: 'Hotel price level and trend for coming weekend nights in major Japanese areas', responses: { 200: obj('Hotels') } } },
      '/books.json': { get: { operationId: 'upcomingReleases', summary: 'Upcoming release dates of popular Japanese manga series (Japanese only)', responses: { 200: obj('Books') } } },
      '/{lang}/sale.json': { get: { operationId: 'saleCheckInLanguage', summary: 'Sale check, in another language', parameters: [langParam], responses: { 200: obj('Sale check') } } },
      '/{lang}/hotels.json': { get: { operationId: 'hotelOutlookInLanguage', summary: 'Hotel outlook, in another language', parameters: [langParam], responses: { 200: obj('Hotels') } } },
    },
  };
}

function sitemap(byLocale, date) {
  const urls = [];
  for (const { L, records } of byLocale) {
    urls.push(pageUrl(L), pageUrl(L, 'llms.txt'), pageUrl(L, 'sale/'), pageUrl(L, 'compat/'), pageUrl(L, 'hotels/'), ...records.flatMap((r) => [r.links.html, r.links.markdown]));
  }
  urls.push(url('about/'), url('en/about/'));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${date}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------- main

const SALE_ORDER = Object.fromEntries(SALE_VERDICTS.map((v, i) => [v, i]));

function saleRecord(records, latestById, L, index) {
  const names = Object.values(latestById).flatMap((l) => (l?.items || []).map((x) => x.name));
  const date = Object.values(latestById).find(Boolean)?.date ?? null;
  const events = date
    ? activeEvents(date, names).map((e) => ({ ...e, label: ui(L, `event_${e.id}`), note: ui(L, e.kind === 'points' ? 'eventPointsNote' : 'eventSaleNote') }))
    : [];
  const items = records
    .flatMap((r) => r.items.filter((x) => x.sale_check).map((x) => ({ r, x })))
    .map(({ r, x }) => ({
      category: r.id,
      category_name: r.name,
      id: x.id,
      title: x.title,
      price: x.price,
      median_90d: x.price_check.median_90d,
      observed_days: x.price_check.observed_days,
      ...x.sale_check,
      page: r.links.html,
      buy_url: x.buy_url,
    }))
    .sort((a, b) => SALE_ORDER[a.verdict] - SALE_ORDER[b.verdict] || (b.actual_drop_pct ?? -99) - (a.actual_drop_pct ?? -99));
  const counts = Object.fromEntries(SALE_VERDICTS.map((v) => [v, items.filter((i) => i.verdict === v).length]));
  return {
    schema: 'shelf.sale/v1',
    lang: L.lang,
    sample: index.sample,
    date,
    updated_at: index.updated_at,
    disclosure: index.disclosure,
    method: ui(L, 'saleMethod'),
    events,
    counts,
    items,
    links: { html: pageUrl(L, 'sale/'), json: apiUrl(L, 'sale.json') },
  };
}

function saleHtml(sale, L) {
  const events = sale.events.length
    ? `<ul>${sale.events.map((e) => `<li><strong>${esc(e.label)}</strong> — ${esc(e.note)}</li>`).join('')}</ul>`
    : `<p>${esc(ui(L, 'saleNoEvent'))}</p>`;
  const sections = SALE_VERDICTS.map((v) => {
    const list = sale.items.filter((i) => i.verdict === v);
    if (!list.length) return '';
    const rows = list
      .map((i) => {
        const claim = i.claimed_pct != null ? `${i.claimed_up_to ? ui(L, 'saleUpTo') : ''}${i.claimed_pct}%OFF` : `${L.money(i.claimed_yen)} OFF`;
        const actual = i.actual_drop_pct != null ? ui(L, 'saleActual', { pct: i.actual_drop_pct, median: L.money(i.median_90d) }) : '';
        return `<li><a href="${esc(i.page)}">${esc(i.category_name)}</a> — <span lang="ja">${esc(i.title)}</span><br><strong>${L.money(i.price)}</strong> · ${esc(ui(L, 'saleClaimed', { claim }))}${actual ? ` · ${esc(actual)}` : ''}</li>`;
      })
      .join('\n');
    return `<h2><span class="sale s-${v}">${esc(ui(L, `sale_${v}`))}</span> (${list.length})</h2>
<p><small>${esc(ui(L, `saleExplain_${v}`))}</small></p>
<ul class="sale-list">${rows}</ul>`;
  }).join('\n');
  const body = `<p class="pr">${esc(ui(L, 'prLabel'))}</p>
<h1>${esc(ui(L, 'saleTitle'))}</h1>
<p class="lead">${esc(ui(L, 'saleLead'))}</p>
<p class="meta">${esc(ui(L, 'metaLine', { date: sale.date ?? '—', count: sale.items.length }))}</p>
<h2>${esc(ui(L, 'saleEvents'))}</h2>
${events}
${sections || `<p>${esc(ui(L, 'saleNoClaims'))}</p>`}
<h2>${esc(ui(L, 'methodTitle'))}</h2><p>${esc(sale.method)}</p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(sale.links.json)}">JSON</a></p>`;
  return page({
    L,
    title: `${ui(L, 'saleTitle')}｜SHELF`,
    description: ui(L, 'saleLead'),
    canonical: sale.links.html,
    root: depthRoot(L, 1),
    sample: sale.sample,
    body,
    alternates: [{ type: 'application/json', href: sale.links.json }],
    hreflang: hreflangs((X) => pageUrl(X, 'sale/')),
  });
}

function compatRecord(records, L, index) {
  const recOf = (id) => records.find((r) => r.id === id);
  return {
    schema: 'shelf.compat/v1',
    lang: L.lang,
    sample: index.sample,
    disclosure: index.disclosure,
    how_to_use: ui(L, 'compatHow'),
    // Rules are applied in order; the first match wins. `model` is matched
    // against the upper-cased model number with spaces and hyphens removed,
    // `name` against the text as typed (case-insensitive).
    rules: COMPAT_RULES.map((r) => {
      const heads = r.headCategory ? recOf(r.headCategory) : null;
      const cheapest = heads?.unit_ranking?.[0] ? heads.items.find((x) => x.id === heads.unit_ranking[0]) : null;
      return {
        id: r.id,
        brand: r.brand,
        match: r.match,
        heads: ui(L, `head_${r.heads}`),
        confidence: r.confidence,
        confidence_label: ui(L, `compat_${r.confidence}`),
        source: r.source,
        ...(heads ? { head_category: { id: heads.id, name: heads.name, page: heads.links.html, json: heads.links.json } } : {}),
        ...(cheapest ? { cheapest_per_head: { title: cheapest.title, price: cheapest.price, unit_price: cheapest.unit_price, buy_url: cheapest.buy_url } } : {}),
      };
    }),
    unknown: ui(L, 'compatUnknown'),
    links: { html: pageUrl(L, 'compat/'), json: apiUrl(L, 'compat.json') },
  };
}

function compatHtml(c, L) {
  const rows = c.rules
    .map(
      (r) => `<tr><td>${esc(r.brand)}<br><small><code>${esc([r.match.model, r.match.name].filter(Boolean).join(' / '))}</code></small></td>
<td><strong>${esc(r.heads)}</strong><br><span class="verdict">${esc(r.confidence_label)}</span>${r.head_category ? `<br><a href="${esc(r.head_category.page)}">${esc(r.head_category.name)}</a>` : ''}${r.cheapest_per_head ? `<br><small>${esc(ui(L, 'compatCheapest', { price: L.money(r.cheapest_per_head.unit_price.value) }))}</small>` : ''}</td>
<td><small>“${esc(r.source.quote)}”</small><br><a href="${esc(r.source.url)}">${esc(new URL(r.source.url).hostname)}</a></td></tr>`,
    )
    .join('\n');
  const body = `<p class="pr">${esc(ui(L, 'prLabel'))}</p>
<h1>${esc(ui(L, 'compatTitle'))}</h1>
<p class="lead">${esc(ui(L, 'compatLead'))}</p>
<p>${esc(c.how_to_use)}</p>
<div class="scroll"><table><thead><tr><th>${esc(ui(L, 'compatHandle'))}</th><th>${esc(ui(L, 'compatHeads'))}</th><th>${esc(ui(L, 'compatSource'))}</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p><small>${esc(c.unknown)}</small></p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(c.links.json)}">JSON</a> ・ MCP: <code>check_compatibility</code></p>`;
  return page({
    L,
    title: `${ui(L, 'compatTitle')}｜SHELF`,
    description: ui(L, 'compatLead'),
    canonical: c.links.html,
    root: depthRoot(L, 1),
    sample: c.sample,
    noindex: false,
    body,
    alternates: [{ type: 'application/json', href: c.links.json }],
    hreflang: hreflangs((X) => pageUrl(X, 'compat/')),
  });
}

// ---------------------------------------------------------------- hotels

function hotelsRecord(L, buildDate, sample) {
  const latest = readJson(path.join(DATA_DIR, 'hotels', 'latest.json'), null);
  const history = readJson(path.join(DATA_DIR, 'hotels', 'history.json'), {});
  const weekday = new Intl.DateTimeFormat(L.numberLocale, { weekday: 'short', timeZone: 'UTC' });
  const areas = AREAS.map((a) => ({
    id: a.id,
    name: a.names[L.lang] ?? a.names.en,
    location: { lat: a.lat, lng: a.lng, radius_km: a.radius },
    nights: (latest?.nights || [])
      .filter((n) => n >= buildDate && latest.areas?.[a.id]?.[n])
      .map((n) => {
        const snap = latest.areas[a.id][n];
        const trend = nightTrend(history[`${a.id}|${n}`]);
        return {
          date: n,
          weekday: weekday.format(new Date(`${n}T00:00:00Z`)),
          days_ahead: daysBetween(buildDate, n),
          level: snap.level,
          lowest: snap.min,
          available: snap.available,
          trend: { ...trend, label: ui(L, `hotel_${trend.verdict}`), advice: ui(L, `hotelAdvice_${trend.verdict}`) },
          cheapest: snap.cheapest.map((h) => ({ name: h.name, price: h.price, rating: h.rating, reviews: h.reviews, url: h.url })),
        };
      }),
  }));
  return {
    schema: 'shelf.hotels/v1',
    lang: L.lang,
    sample,
    data_date: latest?.date ?? null,
    updated_at: latest?.fetchedAt ?? null,
    disclosure: ui(L, 'hotelsDisclosure'),
    note: ui(L, 'hotelsNote'),
    method: ui(L, 'hotelsMethod'),
    areas,
    links: { html: pageUrl(L, 'hotels/'), markdown: pageUrl(L, 'hotels.md'), json: apiUrl(L, 'hotels.json') },
  };
}

function hotelsMarkdown(h, L) {
  const out = [`# ${ui(L, 'hotelsTitle')} — SHELF`, '', `> ${h.disclosure}`, `> ${h.data_date ?? '—'} · Rakuten Travel (${SITE.credit.text})`, ''];
  if (h.sample) out.push(ui(L, 'sampleNotice'), '');
  out.push(ui(L, 'hotelsLead'), '', h.note, '');
  for (const a of h.areas) {
    out.push(`## ${a.name}`, '', `| ${ui(L, 'hotelsStay')} | ${ui(L, 'hotelsLevel')} | ${ui(L, 'hotelsFound')} | ${ui(L, 'hotelsTrend')} | ${ui(L, 'hotelsCheapest')} |`, '| --- | --- | --- | --- | --- |');
    for (const n of a.nights) {
      const c = n.cheapest[0];
      out.push(`| ${n.date} (${n.weekday}) | ${L.money(n.level)} | ${n.available} | ${n.trend.label}${n.trend.change_pct != null ? ` (${n.trend.change_pct > 0 ? '+' : ''}${n.trend.change_pct}%)` : ''} — ${n.trend.advice} | ${c ? `[${mdCell(c.name)}](${c.url}) ${L.money(c.price)}` : '—'} |`);
    }
    out.push('');
  }
  out.push(`## ${ui(L, 'methodTitle')}`, '', h.method, '', `- JSON: ${h.links.json}`, '');
  return out.join('\n');
}

function hotelsHtml(h, L) {
  const sections = h.areas
    .map((a) => {
      const rows = a.nights
        .map((n) => {
          const c = n.cheapest[0];
          return `<tr><td class="c-rank">${esc(n.date)}<br><small>${esc(n.weekday)} · ${esc(ui(L, 'hotelsDaysAhead', { days: n.days_ahead }))}</small></td><td class="c-price num">${L.money(n.level)}</td><td class="c-rating num">${n.available}</td><td class="c-verdict"><span class="verdict h-${esc(n.trend.verdict)}">${esc(n.trend.label)}</span>${n.trend.change_pct != null ? ` <small>${n.trend.change_pct > 0 ? '+' : ''}${n.trend.change_pct}%</small>` : ''}<br><small>${esc(n.trend.advice)}</small></td><td class="c-item">${c ? `<a rel="sponsored nofollow noopener" target="_blank" href="${esc(c.url)}" lang="ja">${esc(c.name)}</a><br><small>${L.money(c.price)}${c.rating ? ` · ★${c.rating}` : ''}</small>` : '—'}</td></tr>`;
        })
        .join('\n');
      return `<h2 id="${esc(a.id)}">${esc(a.name)}</h2>
<div class="scroll"><table class="hotel"><thead><tr><th>${esc(ui(L, 'hotelsStay'))}</th><th>${esc(ui(L, 'hotelsLevel'))}</th><th>${esc(ui(L, 'hotelsFound'))}</th><th>${esc(ui(L, 'hotelsTrend'))}</th><th>${esc(ui(L, 'hotelsCheapest'))}</th></tr></thead><tbody>
${rows}
</tbody></table></div>`;
    })
    .join('\n');
  const body = `<p class="pr">${esc(ui(L, 'prLabel'))}</p>
<h1>${esc(ui(L, 'hotelsTitle'))}</h1>
<p class="lead">${esc(ui(L, 'hotelsLead'))}</p>
<p><small>${esc(h.note)}</small></p>
${sections}
<h2>${esc(ui(L, 'methodTitle'))}</h2><p>${esc(h.method)}</p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(h.links.markdown)}">Markdown</a> ・ <a href="${esc(h.links.json)}">JSON</a></p>`;
  return page({
    L,
    title: `${ui(L, 'hotelsTitle')}｜SHELF`,
    description: ui(L, 'hotelsLead'),
    canonical: h.links.html,
    root: depthRoot(L, 1),
    sample: h.sample,
    body,
    alternates: [
      { type: 'text/markdown', href: h.links.markdown },
      { type: 'application/json', href: h.links.json },
    ],
    hreflang: hreflangs((X) => pageUrl(X, 'hotels/')),
  });
}

// ---------------------------------------------------------------- books (ja)

function booksRecord(buildDate, sample) {
  const latest = readJson(path.join(DATA_DIR, 'books', 'latest.json'), { series: {} });
  const all = SERIES.flatMap((s) => (latest.series?.[s.id] || []).map((b) => ({ ...b, series_title: s.title })));
  const until = (b) => b.sales_until || parseSalesDate(b.sales_date_text)?.until || b.sales_date;
  const upcoming = all.filter((b) => until(b) >= buildDate).sort((a, b) => a.sales_date.localeCompare(b.sales_date));
  const recentFrom = new Date(Date.parse(`${buildDate}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const recent = all.filter((b) => until(b) < buildDate && b.sales_date >= recentFrom).sort((a, b) => b.sales_date.localeCompare(a.sales_date));
  return {
    schema: 'shelf.books/v1',
    lang: 'ja',
    sample,
    data_date: latest.date ?? null,
    disclosure: BOOKS_TEXT.disclosure,
    method: BOOKS_TEXT.method,
    series: SERIES.map((s) => ({ id: s.id, title: s.title })),
    upcoming,
    recent,
    links: { html: url('books/'), json: url(`api/${SITE.apiVersion}/books.json`), ics: url('books.ics'), atom: url('books.xml') },
  };
}

function booksHtml(b) {
  const L = SOURCE;
  const T = BOOKS_TEXT;
  const row = (x) =>
    `<tr><td class="c-rank">${esc(x.sales_date_text)}${x.preorder ? `<br><span class="verdict">${esc(T.preorder)}</span>` : ''}</td><td class="c-item">${esc(x.title)}<br><small>${esc(x.author ?? '')} · ${esc(x.publisher ?? '')}</small></td><td class="c-price num">${x.price ? L.money(x.price) : '—'}</td><td class="c-buy"><a rel="sponsored nofollow noopener" target="_blank" href="${esc(x.buy_url)}">${esc(T.buy)}</a></td></tr>`;
  const table = (list) =>
    list.length
      ? `<div class="scroll"><table class="rank"><thead><tr><th>${esc(T.date)}</th><th>${esc(T.volume)}</th><th>${esc(T.price)}</th><th></th></tr></thead><tbody>${list.map(row).join('\n')}</tbody></table></div>`
      : `<p>${esc(T.none)}</p>`;
  const body = `<p class="pr">${esc(ui(L, 'prLabel'))}</p>
<h1>${esc(T.title)}</h1>
<p class="lead">${esc(T.lead)}</p>
<p>${esc(T.subscribe)}: <a href="${esc(b.links.ics)}">${esc(T.ics)}</a> ・ <a href="${esc(b.links.atom)}">${esc(T.atom)}</a></p>
<h2>${esc(T.upcoming)}</h2>
${table(b.upcoming)}
<h2>${esc(T.recent)}</h2>
${table(b.recent)}
<h2>${esc(ui(L, 'methodTitle'))}</h2><p>${esc(b.method)}</p>
<p><small>${esc(T.series)}: ${b.series.map((s) => esc(s.title)).join(' / ')}</small></p>
<p class="data">${esc(ui(L, 'pageData'))}: <a href="${esc(b.links.json)}">JSON</a></p>`;
  return page({
    L,
    title: `${T.title}｜SHELF`,
    description: T.lead,
    canonical: b.links.html,
    root: depthRoot(L, 1),
    sample: b.sample,
    body,
    alternates: [
      { type: 'application/json', href: b.links.json },
      { type: 'application/atom+xml', href: b.links.atom },
      { type: 'text/calendar', href: b.links.ics },
    ],
  });
}

function writeBooks(b, updated) {
  write(`api/${SITE.apiVersion}/books.json`, b);
  write('books/index.html', booksHtml(b));
  write('books.ics', icsCalendar(b.upcoming, { name: `SHELF ${BOOKS_TEXT.title}`, url: b.links.html, stamp: b.data_date || b.updated_at?.slice(0, 10) }));
  write(
    'books.xml',
    atomFeed({
      id: b.links.atom,
      title: `SHELF — ${BOOKS_TEXT.title}`,
      subtitle: BOOKS_TEXT.disclosure,
      selfUrl: b.links.atom,
      pageUrl: b.links.html,
      updated,
      lang: 'ja',
      entries: b.upcoming.map((x) => ({ id: `${b.links.atom}#${x.isbn}@${x.sales_date}`, title: x.title, link: b.links.html, updated, summary: `${x.sales_date_text} / ${x.publisher ?? ''}` })),
    }),
  );
}

function buildLocale(L, state, latestById, buildDate) {
  // Some categories only make sense in some languages (furusato nozei is for
  // Japanese taxpayers).
  const records = CATEGORIES.filter((c) => !c.langs || c.langs.includes(L.lang)).map((c) => categoryRecord(c, latestById[c.id], state, buildDate, L));
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

  // Hotels (every language) and the books calendar (Japanese only).
  const hotels = hotelsRecord(L, buildDate, index.sample);
  write(`api/${SITE.apiVersion}/${prefix(L)}hotels.json`, hotels);
  write(`${prefix(L)}hotels/index.html`, hotelsHtml(hotels, L));
  write(`${prefix(L)}hotels.md`, hotelsMarkdown(hotels, L));
  if (L === SOURCE) writeBooks(booksRecord(buildDate, index.sample), index.updated_at ?? `${buildDate}T00:00:00+09:00`);

  // Brush-head compatibility.
  const compat = compatRecord(records, L, index);
  write(`api/${SITE.apiVersion}/${prefix(L)}compat.json`, compat);
  write(`${prefix(L)}compat/index.html`, compatHtml(compat, L));

  // Sale truth check across categories.
  const sale = saleRecord(records, latestById, L, index);
  write(`api/${SITE.apiVersion}/${prefix(L)}sale.json`, sale);
  write(`${prefix(L)}sale/index.html`, saleHtml(sale, L));

  // Atom feeds: everything below its usual price, and per category.
  const updated = index.updated_at ?? `${buildDate}T00:00:00+09:00`;
  const describe = (x) =>
    ui(L, 'feedSummary', { price: L.money(x.price), median: L.money(x.median_90d ?? x.price_check?.median_90d), pct: x.drop_pct ?? Math.round((1 - x.price / x.price_check.median_90d) * 1000) / 10 });
  const pageOf = (x) => `${pageUrl(L, `c/${x.category}/`)}`;
  write(
    `${prefix(L)}deals.xml`,
    atomFeed({
      id: pageUrl(L, 'deals.xml'),
      title: `SHELF — ${ui(L, 'feedTitle')}`,
      subtitle: L.disclosure.affiliate,
      selfUrl: pageUrl(L, 'deals.xml'),
      pageUrl: pageUrl(L),
      updated,
      lang: L.lang,
      entries: dealEntries(deals.slice(0, 50), { base: pageUrl(L, 'deals.xml'), pageOf, updated, describe }),
    }),
  );
  for (const r of records) {
    const cheap = r.items
      .filter((x) => ['lowest_observed', 'below_usual'].includes(x.price_check.verdict) && !x.price_check.suspicious && !x.variants)
      .map((x) => ({ ...x, category: r.id }));
    write(
      `${prefix(L)}c/${r.id}/feed.xml`,
      atomFeed({
        id: r.links.feed,
        title: `SHELF — ${r.name}: ${ui(L, 'feedTitle')}`,
        selfUrl: r.links.feed,
        pageUrl: r.links.html,
        updated,
        lang: L.lang,
        entries: dealEntries(cheap, { base: r.links.feed, pageOf, updated, describe }),
      }),
    );
  }
  return { L, records, index };
}

export function build({ now = new Date() } = {}) {
  const state = readJson(path.join(DATA_DIR, 'state.json'), { mode: 'sample', categories: {} });
  const buildDate = todayJst(now);
  const latestById = Object.fromEntries(CATEGORIES.map((c) => [c.id, readJson(path.join(DATA_DIR, 'latest', `${c.id}.json`), null)]));

  for (const dir of ['c', 'api', 'about', 'sale', 'compat', 'hotels', 'books', ...LOCALES.filter((L) => L !== SOURCE).map((L) => L.slug)]) {
    fs.rmSync(path.join(OUT_DIR, dir), { recursive: true, force: true });
  }
  const byLocale = LOCALES.map((L) => buildLocale(L, state, latestById, buildDate));
  const { records, index } = byLocale[0];

  write('openapi.json', openApi(records));
  write('sitemap.xml', sitemap(byLocale, buildDate));
  // Only takes effect at a domain root (the Cloudflare deployment).
  // AI crawlers are named explicitly: SHELF wants to be read and cited.
  const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Amazonbot', 'meta-externalagent', 'DuckAssistBot', 'MistralAI-User', 'CCBot'];
  write('robots.txt', `${AI_AGENTS.map((a) => `User-agent: ${a}\nAllow: /\n`).join('\n')}\nUser-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n`);
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
