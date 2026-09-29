// Every language covers everything the source says, and the built site and
// MCP server actually answer in the language asked for.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../categories.mjs';
import { LOCALES, SOURCE, byLang, detectLang } from '../i18n/index.mjs';

const EN = byLang('en');
const TRANSLATIONS = LOCALES.filter((L) => L !== SOURCE);
const keys = (o) => Object.keys(o).sort();

test('every translation has every string English has', () => {
  for (const L of TRANSLATIONS) {
    for (const part of ['ui', 'llms', 'verdicts', 'outlook', 'disclosure']) assert.deepEqual(keys(L[part]), keys(EN[part]), `${L.lang}.${part}`);
    assert.deepEqual(keys(L.method), keys(EN.method), `${L.lang}.method`);
    assert.deepEqual(keys(L.method.picks), keys(EN.method.picks), `${L.lang}.method.picks`);
  }
  // Japanese needs everything except the notes aimed at people outside Japan.
  const jaOnlyMissing = keys(EN.ui).filter((k) => !(k in SOURCE.ui));
  assert.deepEqual(jaOnlyMissing, ['visitorNote', 'visitorTitle']);
});

test('every translation covers every category, criterion, spec and value', () => {
  for (const L of TRANSLATIONS) {
    for (const c of CATEGORIES) {
      const tr = L.categories[c.id];
      assert.ok(tr, `${L.lang}: ${c.id}`);
      assert.equal(tr.guide.criteria.length, c.guide.criteria.length, `${L.lang}/${c.id} criteria`);
      assert.equal(tr.guide.pitfalls.length, c.guide.pitfalls.length, `${L.lang}/${c.id} pitfalls`);
      assert.ok(tr.guide.summary && tr.guide.abroad, `${L.lang}/${c.id} summary/abroad`);
      for (const f of [...c.facets, ...(c.derived || [])]) assert.ok(tr.facets[f.key], `${L.lang}/${c.id} facet ${f.key}`);
      for (const f of c.facets.filter((f) => f.type === 'enum')) {
        for (const o of f.options) assert.ok(tr.options?.[f.key]?.[o.value], `${L.lang}/${c.id} ${f.key}=${o.value}`);
      }
    }
    for (const [key, values] of Object.entries(SOURCE.derivedValues)) assert.deepEqual(keys(L.derivedValues[key]), keys(values), `${L.lang} ${key}`);
  }
});

test('language detection from user input', () => {
  assert.equal(detectLang('가습기 추천'), 'ko');
  assert.equal(detectLang('モバイルバッテリー'), 'ja');
  assert.equal(detectLang('humidifier'), 'en');
  assert.equal(detectLang('加湿器'), 'ja');
});

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-i18n-'));
const env = { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out'), RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '' };
execFileSync(process.execPath, [path.join(TOOL, 'update.mjs')], { env, stdio: 'pipe' });
const out = (rel) => fs.readFileSync(path.join(tmp, 'out', rel), 'utf8');

test('every language is published, linked and labelled', () => {
  for (const L of TRANSLATIONS) {
    const html = out(`${L.slug}/c/humidifier/index.html`);
    assert.match(html, new RegExp(`<html lang="${L.lang}">`));
    for (const X of LOCALES) assert.match(html, new RegExp(`hreflang="${X.lang}"`));
    assert.match(html, /hreflang="x-default" href="[^"]+\/en\/c\/humidifier\/"/);
    assert.match(html, /href="\.\.\/\.\.\/\.\.\/assets\/style\.css"/);
    const rec = JSON.parse(out(`api/v1/${L.slug}/c/humidifier.json`));
    assert.equal(rec.lang, L.lang);
    assert.equal(rec.name, L.categories.humidifier.name);
    assert.equal(rec.names.ja, '加湿器');
    assert.ok(rec.market.for_visitors);
    assert.ok(rec.how_to_choose.abroad);
    assert.ok(out(`${L.slug}/llms.txt`).startsWith('# SHELF'));
  }
  assert.match(out('zh-hans/c/mobile-battery.md'), /\d 日元/);
  assert.match(out('ko/c/mobile-battery.md'), /\d엔/);
  assert.match(out('llms.txt'), /\[English\]\([^)]+\/en\/llms\.txt\)/);
  const ja = JSON.parse(out('api/v1/c/humidifier.json'));
  assert.equal(ja.lang, 'ja');
  assert.equal(ja.market.for_visitors, undefined);
  assert.deepEqual(JSON.parse(out('openapi.json')).paths['/{lang}/c/{category}.json'].get.parameters[0].schema.enum, ['en', 'zh-hans', 'zh-hant', 'ko']);
  assert.match(out('sitemap.xml'), /\/ko\/c\/humidifier\//);
});

function mcp() {
  const child = spawn(process.execPath, [path.join(TOOL, '..', 'mcp', 'server.mjs')], { env: { ...process.env, SHELF_LOCAL_DIR: path.join(tmp, 'out', 'api/v1') } });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const tool = (name, args) =>
    new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, (m) => resolve(m.result));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    });
  return { tool, close: () => child.kill() };
}

test('MCP answers in the language asked for or typed in', async () => {
  const s = mcp();
  try {
    const ko = await s.tool('recommend', { category: '가습기', limit: 1 });
    assert.equal(ko.isError, false);
    assert.equal(ko.structuredContent.lang, 'ko');
    assert.match(ko.content[0].text, /# 가습기/);
    assert.match(ko.content[0].text, /Buying from outside Japan/);
    const tw = await s.tool('recommend', { category: 'humidifier', lang: 'zh-TW', limit: 1 });
    assert.equal(tw.structuredContent.lang, 'zh-Hant');
    assert.match(tw.content[0].text, /# 加濕器/);
    const en = await s.tool('price_outlook', { category: 'electric kettle' });
    assert.equal(en.structuredContent.lang, 'en');
    assert.match(en.content[0].text, /# Electric kettles/);
    const ja = await s.tool('recommend', { category: '電気ケトル', limit: 1 });
    assert.equal(ja.structuredContent.lang, 'ja');
    assert.equal((await s.tool('list_categories', { lang: 'fr' })).isError, true);
    const list = await s.tool('list_categories', { lang: 'zh-Hans' });
    assert.match(list.content[0].text, /充电宝/);
  } finally {
    s.close();
  }
});
