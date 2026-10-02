// What makes SHELF easy to cite: answer-first facts and FAQ with dates and
// numbers, a weekly price index, structured data, crawler access, IndexNow.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { priceIndex } from '../build.mjs';
import { urlsFromSitemap, payload } from '../indexnow.mjs';

test('price index: median of weekly low ÷ usual price, only weeks with 3+ items', () => {
  const item = (median, weeks) => ({ price_check: { median_90d: median, weekly_low: weeks } });
  const idx = priceIndex([
    item(1000, [['2026-09-25', 1000], ['2026-10-02', 900]]),
    item(2000, [['2026-09-25', 2000], ['2026-10-02', 1900]]),
    item(500, [['2026-09-25', 500], ['2026-10-02', 450]]),
    item(800, [['2026-09-18', 800]]),
  ]);
  assert.deepEqual(idx, [
    { week_end: '2026-09-25', index: 100, items: 3 },
    { week_end: '2026-10-02', index: 90, items: 3 },
  ]);
});

test('IndexNow payload keeps only this host’s URLs', () => {
  const urls = urlsFromSitemap('<urlset><url><loc>https://s.example.com/a?x=1&amp;y=2</loc></url><url><loc>https://other.example/b</loc></url></urlset>');
  const body = payload('https://s.example.com', 'abcdef1234', urls);
  assert.deepEqual(body, { host: 's.example.com', key: 'abcdef1234', keyLocation: 'https://s.example.com/abcdef1234.txt', urlList: ['https://s.example.com/a?x=1&y=2'] });
});

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-cite-'));
execFileSync(process.execPath, [path.join(TOOL, 'update.mjs')], {
  env: { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out'), RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '', YAHOO_APP_ID: '' },
  stdio: 'pipe',
});
const read = (rel) => fs.readFileSync(path.join(tmp, 'out', rel), 'utf8');

test('category pages lead with dated facts and a FAQ, in every language', () => {
  for (const p of ['', 'en/', 'zh-hans/', 'zh-hant/', 'ko/']) {
    const rec = JSON.parse(read(`api/v1/${p}c/rice.json`));
    assert.ok(rec.key_facts.length >= 3, p);
    assert.ok(rec.faq.length >= 4, p);
    for (const { q, a } of rec.faq) {
      assert.ok(q.includes(rec.name), `${p} question names the category: ${q}`);
      if (!a.startsWith(rec.how_to_choose.summary)) assert.ok(a.includes(rec.data_date), `${p} answer is dated: ${a}`);
    }
    assert.ok(rec.price_index.length >= 2);
    assert.match(rec.license, /CC BY 4\.0/);
    const md = read(`${p}c/rice.md`);
    assert.ok(md.indexOf(rec.key_facts[0]) < md.indexOf(rec.how_to_choose.criteria[0].detail), `${p} facts come before the guide`);
    const html = read(`${p}c/rice/index.html`);
    assert.match(html, /"@type":"FAQPage"/);
    assert.match(html, /<title>[^<]*(2026|20\d\d)[^<]*<\/title>/);
  }
});

test('discovery: AI crawlers allowed by name, Dataset markup, richer llms.txt', () => {
  const robots = read('robots.txt');
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.match(robots, new RegExp(`User-agent: ${bot}\\nAllow: /`));
  assert.match(read('index.html'), /"@type":"Dataset"[^]*"license":"https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  assert.match(read('llms.txt'), /中央値/);
  assert.match(read('about/index.html'), /編集方針/);
  assert.match(read('en/about/index.html'), /Editorial policy/);
});
