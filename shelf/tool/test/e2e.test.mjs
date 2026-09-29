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

test('MCP server: handshake, tools, recommend with filters, price check', async () => {
  const s = mcp();
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'shelf');
    const tools = await s.call('tools/list', {});
    assert.deepEqual(tools.result.tools.map((t) => t.name), ['list_categories', 'recommend', 'search_products', 'check_price']);

    const rec = await s.call('tools/call', { name: 'recommend', arguments: { category: 'モバイルバッテリー', specs: { capacity_mah: 10000, pse: true }, budget_max: 8000 } });
    assert.equal(rec.result.isError, false);
    const items = rec.result.structuredContent.result.items;
    assert.ok(items.length > 0);
    for (const x of items) {
      assert.ok(x.specs.capacity_mah >= 10000 && x.specs.pse && x.price <= 8000);
    }
    assert.match(rec.result.content[0].text, /SAMPLE DATA/);

    const byEnglish = await s.call('tools/call', { name: 'recommend', arguments: { category: 'kettle' } });
    assert.equal(byEnglish.result.structuredContent.result.category, 'electric-kettle');

    const bad = await s.call('tools/call', { name: 'recommend', arguments: { category: '冷蔵庫' } });
    assert.equal(bad.result.isError, true);

    const price = await s.call('tools/call', { name: 'check_price', arguments: { item_id: items[0].id } });
    assert.match(price.result.content[0].text, /Verdict: \w+/);

    const search = await s.call('tools/call', { name: 'search_products', arguments: { query: 'GaN' } });
    assert.ok(search.result.structuredContent.result.every((x) => /GaN/.test(x.title)));

    const unknown = await s.call('nope', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    s.close();
  }
});
