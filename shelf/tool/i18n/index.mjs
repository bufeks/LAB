// Languages SHELF publishes in. Japanese is the source and keeps the original
// URLs; every other language lives under /<slug>/ (pages) and
// /api/v1/<slug>/ (JSON). Missing strings fall back to English, then Japanese,
// so adding a category never breaks a build; the audit reports the gaps.

import ja from './ja.mjs';
import en from './en.mjs';
import zhHans from './zh-Hans.mjs';
import zhHant from './zh-Hant.mjs';
import ko from './ko.mjs';

export const LOCALES = [ja, en, zhHans, zhHant, ko];
export const SOURCE = ja;

export const byLang = (lang) => LOCALES.find((L) => L.lang === lang || L.slug === lang);

// '' for the source language, 'en/' etc. otherwise.
export const prefix = (L) => (L === SOURCE ? '' : `${L.slug}/`);

export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}

export function ui(L, key, vars) {
  const s = L.ui[key] ?? en.ui[key] ?? ja.ui[key];
  if (s === undefined) throw new Error(`missing ui string ${key}`);
  return fill(s, vars);
}

// Category text in language L: name, guide, and labels for spec fields and
// their values, with `translated` telling whether L actually covers it.
export function localizeCategory(category, L) {
  const tr = L === SOURCE ? null : L.categories[category.id] ?? en.categories[category.id] ?? null;
  const translated = L === SOURCE || Boolean(L.categories[category.id]);
  const facetEntry = (key) => (tr?.facets?.[key] ?? null);
  const source = [...category.facets, ...(category.derived || [])];
  return {
    translated,
    name: tr?.name ?? category.name,
    guide: tr ? { asOf: category.guide.asOf, ...tr.guide } : category.guide,
    label(key) {
      const e = facetEntry(key);
      return (Array.isArray(e) ? e[0] : e) ?? source.find((f) => f.key === key)?.label ?? key;
    },
    unit(key) {
      const e = facetEntry(key);
      const own = source.find((f) => f.key === key)?.unit ?? null;
      return Array.isArray(e) ? e[1] || null : own;
    },
    option(key, value) {
      return tr?.options?.[key]?.[value] ?? category.facets.find((f) => f.key === key)?.options?.find((o) => o.value === value)?.label ?? value;
    },
    derivedValue(key, value) {
      return L.derivedValues?.[key]?.[value] ?? en.derivedValues[key]?.[value] ?? ja.derivedValues[key]?.[value] ?? value;
    },
  };
}

export function verdictText(L, stats) {
  const v = stats?.verdict || 'insufficient_data';
  if (v === 'lowest_observed') return stats.windowDays >= 90 ? L.verdicts.lowest_90d : fill(L.verdicts.lowest_observed, { days: stats.windowDays });
  return L.verdicts[v];
}

// Pick the answer language from what the user typed: Hangul -> ko, kana -> ja,
// Latin only -> en. Han characters alone are ambiguous (加湿器 is both Japanese
// and Chinese) and default to Japanese; agents should pass lang explicitly.
export function detectLang(text) {
  const s = String(text || '');
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'ja';
  if (/[A-Za-z]/.test(s)) return 'en';
  return 'ja';
}
