#!/usr/bin/env node
// Reads the last 7 days of events the Worker wrote to Analytics Engine and
// prints a summary (and appends it to the Actions job summary). Kept out of
// the repository on purpose: traffic numbers are business data.
//
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Account Analytics: Read).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATASET = 'shelf_events';
export const QUERY = `SELECT blob1 AS type, blob2 AS a, blob3 AS b, blob4 AS c, blob5 AS d, SUM(_sample_interval) AS n
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY type, a, b, c, d
ORDER BY n DESC
LIMIT 2000`;

function tally(rows, key) {
  const out = new Map();
  for (const r of rows) out.set(key(r), (out.get(key(r)) || 0) + r.n);
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

const table = (title, head, entries, limit = 10) =>
  entries.length
    ? `### ${title}\n\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${entries
        .slice(0, limit)
        .map(([k, n]) => `| ${[...String(k).split('\u0000'), n].join(' | ')} |`)
        .join('\n')}\n`
    : `### ${title}\n\nnone\n`;

export function summarize(raw) {
  const rows = raw.map((r) => ({ ...r, n: Number(r.n) || 0 }));
  const of = (t) => rows.filter((r) => r.type === t);
  const clicks = of('click');
  const total = (list) => list.reduce((s, r) => s + r.n, 0);
  const L = ['## SHELF traffic, last 7 days', ''];
  L.push(
    `clicks ${total(clicks)} ・ AI referrals ${total(of('ai_referral'))} ・ crawler hits ${total(of('crawl'))} ・ MCP tool calls ${total(of('mcp_call'))} ・ dead links ${total(of('click_gone'))}`,
    '',
  );
  L.push(table('Clicks by category and surface', ['category', 'surface', 'clicks'], tally(clicks, (r) => `${r.a}\u0000${r.c}`)));
  L.push(table('Clicks by AI source', ['source', 'clicks'], tally(clicks.filter((r) => r.d), (r) => r.d)));
  L.push(table('Visits referred by AI assistants', ['assistant', 'visits'], tally(of('ai_referral'), (r) => r.a)));
  L.push(table('AI crawlers', ['bot', 'org', 'hits'], tally(of('crawl'), (r) => `${r.a}\u0000${r.b}`)));
  L.push(table('MCP tool calls', ['tool', 'category', 'calls'], tally(of('mcp_call'), (r) => `${r.a}\u0000${r.b || '—'}`)));
  L.push(table('MCP clients', ['client', 'sessions'], tally(of('mcp_init'), (r) => r.a)));

  // Improvement hints: where attention exists but does not convert.
  const hints = [];
  const crawledCats = new Set(of('crawl').map((r) => r.d.match(/^\/c\/([a-z0-9-]+)/)?.[1]).filter(Boolean));
  const clickedCats = new Set(clicks.map((r) => r.a));
  for (const c of crawledCats) if (!clickedCats.has(c)) hints.push(`${c}: crawled but no clicks — check its picks and guide`);
  if (total(of('click_gone')) > 0) hints.push('links to items that dropped out of the ranking are being clicked — they are redirected to the category page');
  if (!total(of('crawl'))) hints.push('no AI crawler hits yet — submit sitemap.xml and list the MCP endpoint in registries');
  L.push(`### Hints\n\n${hints.length ? hints.map((h) => `- ${h}`).join('\n') : 'none'}\n`);
  return L.join('\n');
}

async function query(accountId, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: QUERY,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).data || [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) {
    console.log('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set; no traffic report.');
    process.exit(0);
  }
  const md = summarize(await query(account, token));
  process.stdout.write(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}`);
}
