#!/usr/bin/env node
// Lists what each translation is missing compared with the source:
//   node shelf/tool/i18n-check.mjs [lang]
// Exit code 1 when anything is missing.

import { CATEGORIES } from './categories.mjs';
import { LOCALES, SOURCE, byLang } from './i18n/index.mjs';

export function missing(L) {
  const EN = byLang('en');
  const out = [];
  const ref = { ...SOURCE.ui, ...EN.ui };
  for (const k of Object.keys(ref)) if (!(k in L.ui)) out.push(`ui.${k}`);
  for (const k of Object.keys(L.ui)) if (!(k in ref)) out.push(`ui.${k} (obsolete: remove)`);
  for (const part of ['llms', 'verdicts', 'outlook', 'disclosure']) for (const k of Object.keys(SOURCE[part])) if (!(k in L[part])) out.push(`${part}.${k}`);
  for (const c of CATEGORIES.filter((c) => !c.langs || c.langs.includes(L.lang))) {
    const tr = L.categories[c.id];
    if (!tr) {
      out.push(`categories.${c.id}`);
      continue;
    }
    if (tr.guide?.criteria?.length !== c.guide.criteria.length) out.push(`categories.${c.id}.guide.criteria (need ${c.guide.criteria.length})`);
    if (tr.guide?.pitfalls?.length !== c.guide.pitfalls.length) out.push(`categories.${c.id}.guide.pitfalls (need ${c.guide.pitfalls.length})`);
    if (!tr.guide?.abroad) out.push(`categories.${c.id}.guide.abroad`);
    if (c.unitPrice && !tr.unit) out.push(`categories.${c.id}.unit`);
    for (const f of [...c.facets, ...(c.derived || [])]) if (!tr.facets?.[f.key]) out.push(`categories.${c.id}.facets.${f.key}`);
    for (const f of c.facets.filter((f) => f.type === 'enum')) for (const o of f.options) if (!tr.options?.[f.key]?.[o.value]) out.push(`categories.${c.id}.options.${f.key}.${o.value}`);
  }
  return out;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const only = process.argv[2];
  let bad = 0;
  for (const L of LOCALES.filter((L) => L !== SOURCE && (!only || L.lang === only))) {
    const m = missing(L);
    bad += m.length;
    console.log(`${L.lang}: ${m.length ? `${m.length} missing\n  ${m.join('\n  ')}` : 'complete'}`);
  }
  process.exit(bad ? 1 : 0);
}
