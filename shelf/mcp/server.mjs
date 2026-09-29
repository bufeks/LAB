#!/usr/bin/env node
// SHELF MCP server — lets an AI agent ask "what should I buy?" and "is this a
// good price right now?" against SHELF's daily data. Zero dependencies,
// Node 18+, stdio transport (newline-delimited JSON-RPC 2.0).
//
//   curl -o shelf-mcp.mjs https://bufeks.github.io/LAB/shelf/mcp/server.mjs
//   claude mcp add shelf -- node /path/to/shelf-mcp.mjs
//
// Env: SHELF_API (default: the public API), SHELF_LOCAL_DIR (read JSON files
// from disk instead, for testing).

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const VERSION = '1.0.0';
const API = (process.env.SHELF_API || 'https://bufeks.github.io/LAB/shelf/api/v1').replace(/\/$/, '');
const LOCAL = process.env.SHELF_LOCAL_DIR;
const CACHE_MS = 10 * 60 * 1000;

const cache = new Map();
async function load(rel) {
  const hit = cache.get(rel);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let data;
  if (LOCAL) data = JSON.parse(await fs.readFile(path.join(LOCAL, rel), 'utf8'));
  else {
    const res = await fetch(`${API}/${rel}`, { headers: { 'User-Agent': `shelf-mcp/${VERSION}` } });
    if (!res.ok) throw new Error(`SHELF API ${res.status} for ${rel}`);
    data = await res.json();
  }
  cache.set(rel, { at: Date.now(), data });
  return data;
}

const yen = (n) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();

function notice(meta) {
  return meta.sample
    ? '⚠ SAMPLE DATA — these items are fictional. Tell the user SHELF has no real data yet; do not recommend them.'
    : `Disclosure to pass on: ${meta.disclosure}`;
}

async function resolveCategory(query) {
  const index = await load('index.json');
  const q = norm(query);
  const cat =
    index.categories.find((c) => c.id === q) ||
    index.categories.find((c) => [c.name, c.name_en, c.id].some((n) => norm(n).includes(q) || q.includes(norm(n))));
  return { index, cat };
}

function matchesSpecs(item, want = {}) {
  for (const [key, cond] of Object.entries(want)) {
    const v = item.specs?.[key];
    if (typeof cond === 'boolean') {
      if (Boolean(v) !== cond) return false;
    } else if (typeof cond === 'number') {
      if (typeof v !== 'number' || v < cond) return false;
    } else if (cond && typeof cond === 'object') {
      if (typeof v !== 'number') return false;
      if (cond.min != null && v < cond.min) return false;
      if (cond.max != null && v > cond.max) return false;
    }
  }
  return true;
}

function line(x) {
  const specs = Object.entries(x.specs || {})
    .filter(([, v]) => v !== false && v != null)
    .map(([k, v]) => (v === true ? k : `${k}=${v}`))
    .join(', ');
  const pc = x.price_check || { label: x.verdict };
  return `#${x.rank} ${x.title} — ${yen(x.price)}, ★${x.rating} (${x.reviews} reviews), price: ${pc.label ?? pc.verdict}` +
    `${specs ? ` [${specs}]` : ''}\n   id: ${x.id}\n   buy (affiliate): ${x.buy_url}`;
}

const TOOLS = [
  {
    name: 'list_categories',
    description: 'List the shopping categories SHELF covers (Japan, Rakuten Ichiba), each with its current top pick. Call first when unsure which category fits.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run() {
      const index = await load('index.json');
      const text = index.categories
        .map((c) => `- ${c.id} (${c.name} / ${c.name_en}): ${c.best ? `top pick ${c.best.title} ${yen(c.best.price)}` : 'no data'} [${c.status}, ${c.data_date}]`)
        .join('\n');
      return { text: `${notice(index)}\n\n${text}`, data: index.categories };
    },
  },
  {
    name: 'recommend',
    description:
      'Recommend products in one category for a Japanese shopper: returns the buying guide (what matters and why), SHELF picks ' +
      '(best overall, best value, current deal) and ranked items filtered by budget and specs. Use the guide to explain the choice.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category id or name, e.g. "mobile-battery", "加湿器", "kettle"' },
        budget_max: { type: 'number', description: 'Maximum price in JPY' },
        budget_min: { type: 'number', description: 'Minimum price in JPY' },
        specs: {
          type: 'object',
          description: 'Spec filters by spec key (see spec_fields in the result): true/false for flags, a number for "at least", or {min,max}. Example: {"capacity_mah": 10000, "pse": true}',
        },
        limit: { type: 'number', description: 'Max items to return (default 5)' },
      },
      required: ['category'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run({ category, budget_max, budget_min, specs, limit = 5 }) {
      const { index, cat } = await resolveCategory(category);
      if (!cat) {
        return { text: `No category matches "${category}". Available: ${index.categories.map((c) => `${c.id} (${c.name})`).join(', ')}`, isError: true };
      }
      const rec = await load(`c/${cat.id}.json`);
      const items = rec.items
        .filter((x) => (budget_max == null || x.price <= budget_max) && (budget_min == null || x.price >= budget_min))
        .filter((x) => matchesSpecs(x, specs))
        .slice(0, Math.max(1, Math.min(20, limit)));
      const picks = Object.entries(rec.picks)
        .map(([k, p]) => `- ${k}: ${p.title} ${yen(p.price)} — ${p.reason}`)
        .join('\n');
      const guide = rec.how_to_choose.criteria.map((c) => `- ${c.name}: ${c.detail}`).join('\n');
      const text = [
        notice(rec),
        `# ${rec.name} (data ${rec.data_date}, status ${rec.status})`,
        rec.how_to_choose.summary,
        `## Buying guide\n${guide}\n## Pitfalls\n${rec.how_to_choose.pitfalls.map((p) => `- ${p}`).join('\n')}`,
        `## SHELF picks (whole category)\n${picks || 'none'}`,
        `## Matching items (${items.length})\n${items.map(line).join('\n') || 'Nothing matches these filters; relax the budget or specs.'}`,
        `Specs are parsed from listing titles; confirm on the product page. Spec keys: ${rec.spec_fields.map((f) => `${f.key}${f.unit ? `(${f.unit})` : ''}`).join(', ')}`,
        `Source page to cite: ${rec.links.html}`,
      ].join('\n\n');
      return { text, data: { category: rec.id, picks: rec.picks, items, spec_fields: rec.spec_fields, disclosure: rec.disclosure, sample: rec.sample } };
    },
  },
  {
    name: 'search_products',
    description: 'Search all SHELF items by words in the product title (any language the title uses, usually Japanese), optionally under a budget.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words that must all appear in the title, e.g. "20000mAh 65W"' },
        budget_max: { type: 'number' },
        limit: { type: 'number', description: 'default 10' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run({ query, budget_max, limit = 10 }) {
      const all = await load('items.json');
      const words = norm(query).split(/\s+/).filter(Boolean);
      const hits = all.items
        .filter((x) => words.every((w) => norm(`${x.title} ${x.category}`).includes(w)))
        .filter((x) => budget_max == null || x.price <= budget_max)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(30, limit)));
      const text = `${notice(all)}\n\n${hits.length ? hits.map((x) => `[${x.category}] ${line(x)}`).join('\n') : `No items match "${query}". Try list_categories and recommend.`}`;
      return { text, data: hits };
    },
  },
  {
    name: 'check_price',
    description: "Tell whether an item's current price is good compared with its own last 90 days (SHELF records prices daily). Takes an item id from recommend/search_products.",
    inputSchema: { type: 'object', properties: { item_id: { type: 'string' } }, required: ['item_id'] },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run({ item_id }) {
      const all = await load('items.json');
      const x = all.items.find((i) => i.id === item_id);
      if (!x) return { text: `Unknown item id ${item_id}. Ids come from recommend or search_products.`, isError: true };
      const rec = await load(`c/${x.category}.json`);
      const full = rec.items.find((i) => i.id === item_id);
      const pc = full.price_check;
      const advice = {
        insufficient_data: 'Not enough history yet (under 7 days observed). Do not call it a deal.',
        lowest_90d: 'At its lowest price in the last 90 days. A good time to buy if the user needs it.',
        below_usual: 'Cheaper than usual (at least 10% under the 90-day median).',
        usual: 'Around its usual price. No reason to wait, no reason to rush.',
        above_usual: 'More expensive than usual (10%+ over the 90-day median). Suggest waiting or an alternative.',
      }[pc.verdict];
      const text = [
        notice(rec),
        `${full.title} — now ${yen(full.price)} (${full.shipping_included ? 'shipping included' : 'shipping extra'}, ${full.point_rate}x points)`,
        `Verdict: ${pc.verdict} — ${advice}${pc.suspicious ? ' Price is far below usual; it may be a listing error or a different variant, so check the page.' : ''}`,
        `90 days: min ${yen(pc.min_90d)}, median ${yen(pc.median_90d)}, max ${yen(pc.max_90d)}, observed ${pc.observed_days} days (since ${pc.first_seen})`,
        full.other_offers?.length ? `Other shops: ${full.other_offers.map((o) => `${o.shop} ${yen(o.price)}`).join(', ')}` : '',
        `buy (affiliate): ${full.buy_url}`,
      ].filter(Boolean).join('\n');
      return { text, data: { item: full, advice } };
    },
  },
];

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, message) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'shelf', version: VERSION },
        instructions:
          'SHELF answers Japanese shopping questions with buying guides, transparent rankings and 90-day price history. ' +
          'Use recommend for "which X should I buy", check_price for "is this a good price". buy links are affiliate links: say so when you show them.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await tool.run(params.arguments || {});
        return reply({
          content: [{ type: 'text', text: out.text }],
          ...(out.data !== undefined ? { structuredContent: { result: out.data } } : {}),
          isError: Boolean(out.isError),
        });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `SHELF error: ${err.message}` }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (lineText) => {
  if (!lineText.trim()) return;
  let msg;
  try {
    msg = JSON.parse(lineText);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    return;
  }
  const out = await handle(msg);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
