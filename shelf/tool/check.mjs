#!/usr/bin/env node
// Audits the built site after every update. Errors fail the job (and the
// workflow opens an issue); warnings are the improvement backlog: a facet
// that rarely parses means its regex needs work, a high rejection rate means
// the search query pulls in the wrong things, affiliate=false means links are
// earning nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './categories.mjs';
import { LOCALES, SOURCE, prefix } from './i18n/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SHELF_DATA_DIR || path.join(HERE, '..', 'data');
const OUT_DIR = process.env.SHELF_OUT_DIR || path.join(HERE, '..');
const MIN_ITEMS = 5;
const MIN_FACET_COVERAGE = 0.5;
const MAX_REJECT_RATE = 0.75;
const MAX_LLMS_TXT_BYTES = 20000;

export function audit() {
  const errors = [];
  const warnings = [];
  const metrics = {};
  const read = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(OUT_DIR, rel), 'utf8'));
    } catch (err) {
      errors.push(`${rel}: ${err.code === 'ENOENT' ? 'missing' : 'invalid JSON'}`);
      return null;
    }
  };
  const state = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8'));
  const live = state.mode === 'live';
  const index = read('api/v1/index.json');
  if (!index) return { errors, warnings, metrics, live };
  if (!live) warnings.push('sample mode: set RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY secrets to publish real data');

  for (const category of CATEGORIES) {
    const rec = read(`api/v1/c/${category.id}.json`);
    const st = state.categories?.[category.id] || {};
    if (st.status === 'error') warnings.push(`${category.id}: last fetch failed: ${st.error}`);
    if (!rec) continue;
    const m = (metrics[category.id] = { items: rec.items.length, status: rec.status });
    if (rec.status === 'stale') warnings.push(`${category.id}: data is ${rec.data_date}, older than 3 days`);
    if (rec.status === 'no_data') (st.skipped ? warnings : errors).push(`${category.id}: no data published${st.skipped ? ` (${st.skipped})` : ''}`);
    if (rec.items.length && rec.items.length < MIN_ITEMS) warnings.push(`${category.id}: only ${rec.items.length} items ranked`);
    if (!rec.disclosure) errors.push(`${category.id}: disclosure missing`);
    if (!fs.existsSync(path.join(OUT_DIR, 'c', `${category.id}.md`))) errors.push(`${category.id}: markdown missing`);

    for (const x of rec.items) {
      if (!/^https:\/\//.test(x.buy_url)) errors.push(`${category.id}: non-https buy_url on ${x.id}`);
      if (live && /^sample[-:]/.test(x.id)) errors.push(`${category.id}: sample item in live data`);
    }
    if (live && rec.items.length) {
      const affiliated = rec.items.filter((x) => x.affiliate).length / rec.items.length;
      m.affiliate_rate = Math.round(affiliated * 100) / 100;
      // Per store, so the message names the secret that is missing.
      const secret = { rakuten: 'RAKUTEN_AFFILIATE_ID', yahoo: 'YAHOO_VC_AFFILIATE_ID' };
      for (const store of new Set(rec.items.map((x) => x.store || 'rakuten'))) {
        const list = rec.items.filter((x) => (x.store || 'rakuten') === store);
        const rate = list.filter((x) => x.affiliate).length / list.length;
        if (rate < 0.9) errors.push(`${category.id}: only ${Math.round(rate * 100)}% of ${store} links are affiliate links (is ${secret[store] || 'the affiliate id'} set?)`);
      }
    }

    // Numeric facets are what agents filter on; low coverage means the
    // title regex misses the way shops actually write the spec.
    m.facet_coverage = {};
    for (const f of category.facets.filter((f) => f.type === 'number')) {
      const cov = rec.items.length ? rec.items.filter((x) => x.specs[f.key] != null).length / rec.items.length : 0;
      m.facet_coverage[f.key] = Math.round(cov * 100) / 100;
      if (live && cov < MIN_FACET_COVERAGE) warnings.push(`${category.id}: facet ${f.key} parsed for only ${Math.round(cov * 100)}% of items`);
    }

    const asOf = category.guide.asOf;
    if (asOf && (Date.now() - Date.parse(`${asOf}-01`)) / 86400000 > 183) warnings.push(`${category.id}: buying guide is as of ${asOf}; review its facts`);
    m.variant_listings = rec.items.filter((x) => x.variants).length;

    const stats = rec.stats;
    if (stats?.candidates) {
      const rejected = Object.values(stats.rejected || {}).reduce((a, b) => a + b, 0);
      m.reject_rate = Math.round((rejected / stats.candidates) * 100) / 100;
      m.rejected = stats.rejected;
      if (m.reject_rate > MAX_REJECT_RATE) warnings.push(`${category.id}: ${Math.round(m.reject_rate * 100)}% of candidates rejected (${JSON.stringify(stats.rejected)}); refine query/ngKeywords`);
    }
    m.suspicious = rec.items.filter((x) => x.price_check.suspicious).length;
    if (m.suspicious) warnings.push(`${category.id}: ${m.suspicious} item(s) priced far below their usual price`);
  }

  // Every language must be published; a category without a translation is
  // served in English as a fallback and listed here for someone to translate.
  metrics.languages = {};
  for (const L of LOCALES.filter((X) => X !== SOURCE)) {
    const untranslated = [];
    for (const category of CATEGORIES.filter((c) => !c.langs || c.langs.includes(L.lang))) {
      const rec = read(`api/v1/${prefix(L)}c/${category.id}.json`);
      if (!rec) continue;
      if (rec.items.length !== (metrics[category.id]?.items ?? rec.items.length)) errors.push(`${L.lang}/${category.id}: item count differs from Japanese`);
      if (!rec.translated) untranslated.push(category.id);
      if (!rec.market?.for_visitors) errors.push(`${L.lang}/${category.id}: visitor notice missing`);
    }
    if (!fs.existsSync(path.join(OUT_DIR, prefix(L), 'llms.txt'))) errors.push(`${L.lang}: llms.txt missing`);
    metrics.languages[L.lang] = { untranslated };
    if (untranslated.length) warnings.push(`${L.lang}: no translation for ${untranslated.join(', ')} (English shown instead)`);
  }

  // Hotels and books are fetched alongside the categories.
  for (const part of ['hotels', 'books']) {
    const st = state[part];
    if (st?.status === 'partial') warnings.push(`${part}: some requests failed: ${(st.errors || []).join(' | ')}`);
    if (st?.status === 'skipped') warnings.push(`${part}: skipped (${st.reason})`);
    if (st?.status === 'error') warnings.push(`${part}: every request failed, previous data kept: ${(st.errors || []).join(' | ')}`);
  }
  for (const [id, c] of Object.entries(state.categories || {})) {
    if (c.sourceErrors?.length) warnings.push(`${id}: one store failed: ${c.sourceErrors.join(' | ')}`);
  }
  for (const rel of ['api/v1/sale.json', 'api/v1/compat.json', 'api/v1/hotels.json', 'api/v1/books.json']) read(rel);
  if (!fs.existsSync(path.join(OUT_DIR, 'deals.xml'))) errors.push('deals.xml missing');

  const llms = fs.readFileSync(path.join(OUT_DIR, 'llms.txt'), 'utf8');
  metrics.llms_txt_bytes = Buffer.byteLength(llms);
  if (metrics.llms_txt_bytes > MAX_LLMS_TXT_BYTES) warnings.push(`llms.txt is ${metrics.llms_txt_bytes} bytes; keep it an index`);
  if (!/^# /.test(llms)) errors.push('llms.txt must start with an H1');
  return { errors, warnings, metrics, live };
}

export function reportMarkdown({ errors, warnings, metrics, live }) {
  const L = [`## SHELF audit (${live ? 'live' : 'sample'})`, ''];
  L.push(errors.length ? `### Errors\n${errors.map((e) => `- ${e}`).join('\n')}` : '### Errors\nnone');
  L.push('');
  L.push(warnings.length ? `### Warnings\n${warnings.map((e) => `- ${e}`).join('\n')}` : '### Warnings\nnone');
  L.push('', '### Metrics', '', '| category | items | status | reject rate | affiliate | facet coverage |', '| --- | --- | --- | --- | --- | --- |');
  for (const [id, m] of Object.entries(metrics)) {
    if (typeof m !== 'object') continue;
    const cov = Object.entries(m.facet_coverage || {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
    L.push(`| ${id} | ${m.items} | ${m.status} | ${m.reject_rate ?? '—'} | ${m.affiliate_rate ?? '—'} | ${cov} |`);
  }
  return L.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = audit();
  const md = reportMarkdown(result);
  fs.writeFileSync(path.join(DATA_DIR, 'report.json'), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 1) + '\n');
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (result.errors.length) process.exit(1);
}
