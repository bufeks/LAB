// Builds the whole site from sample data into a temp dir, then drives the MCP
// server against that output the way an agent would.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-'));
const env = { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out'), RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '' };
execFileSync(process.execPath, [path.join(TOOL, 'update.mjs')], { env, stdio: 'pipe' });
const out = (rel) => path.join(tmp, 'out', rel);
const json = (rel) => JSON.parse(fs.readFileSync(out(rel), 'utf8'));

test('sample builds are flagged everywhere and kept out of search engines', () => {
  assert.equal(json('api/v1/index.json').sample, true);
  assert.match(fs.readFileSync(out('llms.txt'), 'utf8'), /サンプルデータ/);
  assert.match(fs.readFileSync(out('c/humidifier/index.html'), 'utf8'), /noindex/);
  assert.match(fs.readFileSync(out('c/humidifier.md'), 'utf8'), /サンプルデータです/);
});

test('every category is published in all formats', () => {
  const index = json('api/v1/index.json');
  assert.equal(index.categories.length, 6);
  for (const c of index.categories) {
    const rec = json(`api/v1/c/${c.id}.json`);
    assert.ok(rec.items.length >= 3, c.id);
    assert.ok(rec.picks.best, c.id);
    assert.ok(fs.existsSync(out(`c/${c.id}.md`)));
    assert.ok(fs.existsSync(out(`c/${c.id}/index.html`)));
    for (const x of rec.items) assert.match(x.buy_url, /^https:\/\//);
  }
  const openapi = json('openapi.json');
  assert.deepEqual(openapi.paths['/c/{category}.json'].get.parameters[0].schema.enum, index.categories.map((c) => c.id));
});

test('html escapes and carries the affiliate rel', () => {
  const html = fs.readFileSync(out('c/mobile-battery/index.html'), 'utf8');
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /href="\.\.\/\.\.\/assets\/style\.css"/);
});

function mcp() {
  const child = spawn(process.execPath, [path.join(TOOL, '..', 'mcp', 'server.mjs')], {
    env: { ...process.env, SHELF_LOCAL_DIR: out('api/v1') },
  });
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
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return { call, close: () => child.kill() };
}

const call = (s, name, args) => s.call('tools/call', { name, arguments: args }).then((r) => r.result);

test('MCP server: handshake and tool list', async () => {
  const s = mcp();
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'shelf');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    const future = await s.call('initialize', { protocolVersion: '2099-01-01' });
    assert.equal(future.result.protocolVersion, '2025-06-18');
    const tools = await s.call('tools/list', {});
    assert.deepEqual(tools.result.tools.map((t) => t.name), ['list_categories', 'recommend', 'price_outlook', 'search_products', 'check_price']);
    const unknown = await s.call('nope', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    s.close();
  }
});

test('MCP recommend: filters, picks inside the budget, disclosure in structured output', async () => {
  const s = mcp();
  try {
    const rec = await call(s, 'recommend', { category: 'モバイルバッテリー', specs: { capacity_mah: 10000, pse: true }, budget_max: 6000 });
    assert.equal(rec.isError, false);
    const out = rec.structuredContent;
    assert.equal(out.sample, true);
    assert.ok(out.disclosure);
    assert.ok(out.cite.url.endsWith('/c/mobile-battery/'));
    assert.ok(out.result.items.length > 0);
    for (const x of out.result.items) assert.ok(x.specs.capacity_mah >= 10000 && x.specs.pse && x.price <= 6000);
    const bestId = out.result.picks.best;
    assert.ok(out.result.items.some((x) => x.id === bestId));
    assert.match(rec.content[0].text, /SAMPLE DATA/);

    const enumFilter = await call(s, 'recommend', { category: 'humidifier', specs: { type: ['steam', 'hybrid'] }, limit: 'x' });
    assert.ok(enumFilter.structuredContent.result.items.every((x) => ['steam', 'hybrid'].includes(x.specs.type)));

    assert.equal((await call(s, 'recommend', { category: 'kettle' })).structuredContent.result.category, 'electric-kettle');
    for (const bad of [{ category: '冷蔵庫' }, { category: '' }, { category: 'kettle', specs: { capacity: 1 } }, { category: 'humidifier', specs: { type: 'gas' } }, { category: 'kettle', budget_max: 'cheap' }]) {
      const r = await call(s, 'recommend', bad);
      assert.equal(r.isError, true, JSON.stringify(bad));
    }
    const unknownKey = await call(s, 'recommend', { category: 'kettle', specs: { capacity: 1 } });
    assert.match(unknownKey.content[0].text, /capacity_l/);
  } finally {
    s.close();
  }
});

test('MCP price tools: outlook, check_price, search', async () => {
  const s = mcp();
  try {
    const outlook = await call(s, 'price_outlook', { category: '加湿器' });
    assert.ok(['cheaper_than_usual', 'pricier_than_usual', 'usual', 'insufficient_data'].includes(outlook.structuredContent.result.outlook.verdict));
    const items = JSON.parse(fs.readFileSync(out('api/v1/items.json'), 'utf8')).items;
    const price = await call(s, 'check_price', { item_id: items[0].id });
    assert.match(price.content[0].text, /Verdict: \w+/);
    assert.equal((await call(s, 'check_price', { url: 'https://item.rakuten.co.jp/shop/none/' })).isError, true);
    assert.equal((await call(s, 'check_price', {})).isError, true);
    const search = await call(s, 'search_products', { query: 'GaN' });
    assert.ok(search.structuredContent.result.length > 0);
    assert.ok(search.structuredContent.result.every((x) => /GaN/.test(x.title)));
  } finally {
    s.close();
  }
});
