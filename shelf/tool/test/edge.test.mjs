// The Cloudflare Worker, run in Node against an edge build in a temp dir.
// ASSETS is a small file server over that build; EVENTS records data points.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-edge-'));
const BASE = 'https://shelf.example.com';
const env = { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out'), RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '' };
execFileSync(process.execPath, [path.join(TOOL, 'update.mjs')], { env, stdio: 'pipe' });
execFileSync(process.execPath, [path.join(TOOL, 'build.mjs')], { env: { ...env, SHELF_EDGE: '1', SHELF_BASE_URL: BASE }, stdio: 'pipe' });
const OUT = path.join(tmp, 'out');

const { default: worker, botOf, aiReferrer } = await import('../../worker/index.mjs');
const { edgeConfig } = await import('../edge.mjs');

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };
const events = [];
const fakeEnv = {
  EVENTS: { writeDataPoint: (p) => events.push(p.blobs) },
  ASSETS: {
    async fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(OUT, p);
      if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('nf', { status: 404 });
      return new Response(fs.readFileSync(file), { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    },
  },
};
const call = (p, init = {}) => worker.fetch(new Request(`${BASE}${p}`, init), fakeEnv);
const record = (cat) => JSON.parse(fs.readFileSync(path.join(OUT, `api/v1/c/${cat}.json`), 'utf8'));

test('edge build: buy links go through /go/ per surface, direct link kept', () => {
  const x = record('humidifier').items[0];
  assert.equal(x.buy_url, `${BASE}/go/humidifier/${encodeURIComponent(x.id)}?s=api`);
  assert.match(x.affiliate_url, /^https:\/\/search\.rakuten/);
  assert.match(fs.readFileSync(path.join(OUT, 'c/humidifier.md'), 'utf8'), /\/go\/humidifier\/[^)]+\?s=md\)/);
  assert.match(fs.readFileSync(path.join(OUT, 'c/humidifier/index.html'), 'utf8'), /\/go\/humidifier\/[^"]+\?s=html"/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(OUT, 'api/v1/index.json'), 'utf8')).endpoints.mcp_remote, `${BASE}/mcp`);
  assert.match(fs.readFileSync(path.join(OUT, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/shelf\.example\.com\/sitemap\.xml/);
});

test('/go/ redirects to the published affiliate url and counts the click', async () => {
  const x = record('humidifier').items[0];
  events.length = 0;
  const res = await call(`/go/humidifier/${encodeURIComponent(x.id)}?s=md`, { headers: { Referer: 'https://chatgpt.com/c/abc' } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), x.affiliate_url);
  assert.deepEqual(events[0], ['click', 'humidifier', x.id, 'md', 'chatgpt.com']);
});

test('/go/ cannot be used as an open redirect', async () => {
  const unknown = await call('/go/humidifier/https%3A%2F%2Fevil.example');
  assert.equal(unknown.headers.get('Location'), '/c/humidifier/');
  assert.equal((await call('/go/..%2F..%2Fetc/passwd')).status, 404);
  assert.equal((await call('/go/nope-cat/x')).status, 404);
});

test('remote MCP: initialize, notifications, tool call with mcp-tagged links', async () => {
  const post = (body) => call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } } })).json();
  assert.equal(init.result.serverInfo.name, 'shelf');
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  events.length = 0;
  const out = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'recommend', arguments: { category: 'kettle', limit: 1 } } })).json();
  assert.equal(out.result.isError, false);
  assert.match(out.result.structuredContent.result.items[0].buy_url, /\?s=mcp$/);
  assert.deepEqual(events[0].slice(0, 3), ['mcp_call', 'recommend', 'kettle']);
  assert.equal((await call('/mcp')).status, 405);
  assert.equal((await call('/mcp', { method: 'POST', body: '{' })).status, 400);
});

test('crawlers and AI referrals are counted; markdown is served on request', async () => {
  events.length = 0;
  await call('/llms.txt', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' } });
  await call('/c/electric-kettle/', { headers: { Referer: 'https://www.perplexity.ai/search?q=x' } });
  assert.deepEqual(events.map((e) => e.slice(0, 3)), [['crawl', 'ClaudeBot', 'anthropic'], ['ai_referral', 'perplexity.ai', 'html']]);
  const md = await call('/c/electric-kettle/', { headers: { Accept: 'text/markdown, text/html;q=0.8' } });
  assert.equal(md.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.match(await md.text(), /^# 電気ケトル/);
  const api = await call('/api/v1/index.json');
  assert.equal(api.headers.get('Access-Control-Allow-Origin'), '*');
});

test('classifiers and deploy config', () => {
  assert.equal(botOf('Mozilla/5.0 AppleWebKit/537.36; compatible; OAI-SearchBot/1.0').org, 'openai');
  assert.equal(botOf('Mozilla/5.0 (Macintosh)'), null);
  assert.equal(aiReferrer('https://gemini.google.com/app'), 'gemini.google.com');
  assert.equal(aiReferrer('https://evilclaude.ai/'), null);
  assert.deepEqual(edgeConfig({ SHELF_BASE_URL: 'https://shelf.example.com' }).routes, [{ pattern: 'shelf.example.com', custom_domain: true }]);
  assert.equal(edgeConfig({ SHELF_BASE_URL: 'https://bufeks.github.io/LAB/shelf' }).routes, undefined);
  assert.throws(() => edgeConfig({ SHELF_BASE_URL: 'https://example.com/shelf' }), /domain root/);
});

test('traffic summary tallies events and suggests where to look', async () => {
  const { summarize } = await import('../traffic.mjs');
  const md = summarize([
    { type: 'click', a: 'humidifier', b: 'rakuten:x', c: 'md', d: 'chatgpt.com', n: '3' },
    { type: 'click', a: 'humidifier', b: 'rakuten:y', c: 'mcp', d: '', n: '2' },
    { type: 'crawl', a: 'GPTBot', b: 'openai', c: 'md', d: '/c/electric-kettle.md', n: '7' },
    { type: 'mcp_call', a: 'recommend', b: 'humidifier', c: 'client', d: '', n: '4' },
  ]);
  assert.match(md, /clicks 5 ・ AI referrals 0 ・ crawler hits 7 ・ MCP tool calls 4/);
  assert.match(md, /\| humidifier \| md \| 3 \|/);
  assert.match(md, /\| chatgpt\.com \| 3 \|/);
  assert.match(md, /electric-kettle: crawled but no clicks/);
});
