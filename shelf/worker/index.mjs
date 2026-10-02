// SHELF on Cloudflare: serves the static build (bound as ASSETS) and adds the
// few things a static host cannot do.
//
//   POST /mcp              remote MCP (Streamable HTTP, JSON responses)
//   GET  /go/<cat>/<id>    counts a buy-link click, then 302s to Rakuten
//   GET  /c/<cat>/         with Accept: text/markdown, serves the .md page
//   everything else        static files; AI crawler visits and visits
//                          referred by AI assistants are counted
//
// Counts go to Workers Analytics Engine (binding EVENTS, optional): a data
// point per event, blobs = [type, a, b, c, d, lang]. tool/traffic.mjs reads them back.

import { handle, setSource } from '../mcp/server.mjs';

const API_PREFIX = '/api/v1/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

// User-agent token -> organisation. Order matters only for readability.
export const AI_BOTS = [
  ['GPTBot', 'openai'],
  ['OAI-SearchBot', 'openai'],
  ['ChatGPT-User', 'openai'],
  ['ClaudeBot', 'anthropic'],
  ['Claude-SearchBot', 'anthropic'],
  ['Claude-User', 'anthropic'],
  ['anthropic-ai', 'anthropic'],
  ['PerplexityBot', 'perplexity'],
  ['Perplexity-User', 'perplexity'],
  ['Google-CloudVertexBot', 'google'],
  ['Googlebot', 'google'],
  ['bingbot', 'microsoft'],
  ['Applebot', 'apple'],
  ['Amazonbot', 'amazon'],
  ['meta-externalagent', 'meta'],
  ['Bytespider', 'bytedance'],
  ['CCBot', 'commoncrawl'],
  ['DuckAssistBot', 'duckduckgo'],
  ['MistralAI-User', 'mistral'],
  ['cohere-ai', 'cohere'],
];

export const AI_REFERRERS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'grok.com',
  'chat.deepseek.com',
  'you.com',
  'phind.com',
  'felo.ai',
  'genspark.ai',
];

export function botOf(ua = '') {
  const lower = ua.toLowerCase();
  const hit = AI_BOTS.find(([token]) => lower.includes(token.toLowerCase()));
  return hit ? { name: hit[0], org: hit[1] } : null;
}

export function aiReferrer(referer) {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname;
    return AI_REFERRERS.find((d) => host === d || host.endsWith(`.${d}`)) || null;
  } catch {
    return null;
  }
}

function kindOf(path) {
  if (path.endsWith('.md')) return 'md';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.txt')) return 'txt';
  if (path.endsWith('/') || path.endsWith('.html')) return 'html';
  return 'other';
}

function track(env, type, ...fields) {
  try {
    const blobs = [type, ...fields.map((f) => String(f ?? '').slice(0, 200))];
    while (blobs.length < 6) blobs.push('');
    env.EVENTS?.writeDataPoint({ blobs, doubles: [1], indexes: [type] });
  } catch {
    // Counting must never break serving.
  }
}

async function asset(env, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, 'https://assets.local')));
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return res;
}

let sourceReady = false;
function ensureSource(env) {
  if (sourceReady) return;
  setSource(async (rel) => (await asset(env, `${API_PREFIX}${rel}`)).json());
  sourceReady = true;
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });

async function mcp(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    // No server-initiated stream is offered; clients fall back to POST only.
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  ensureSource(env);
  const messages = Array.isArray(body) ? body : [body];
  const client = botOf(request.headers.get('User-Agent') || '')?.org || 'client';
  for (const m of messages) {
    if (m?.method === 'initialize') track(env, 'mcp_init', m.params?.clientInfo?.name || 'unknown', client);
    if (m?.method === 'tools/call') track(env, 'mcp_call', m.params?.name, m.params?.arguments?.category || '', client);
  }
  const replies = (await Promise.all(messages.map((m) => handle(m ?? {})))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? replies : replies[0]);
}

async function go(request, env, url) {
  const [, , cat, rawId] = url.pathname.split('/');
  if (!/^[a-z0-9-]{1,40}$/.test(cat || '') || !rawId) return new Response('Not Found', { status: 404 });
  const id = decodeURIComponent(rawId);
  let rec;
  try {
    rec = await (await asset(env, `${API_PREFIX}c/${cat}.json`)).json();
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  const item = rec.items.find((x) => x.id === id);
  const offer = item ? null : rec.items.flatMap((x) => x.other_offers || []).find((o) => o.id === id);
  const target = item?.affiliate_url || offer?.affiliate_url;
  const surface = (url.searchParams.get('s') || 'unknown').replace(/[^a-z]/g, '').slice(0, 12);
  const lang = (url.searchParams.get('l') || 'ja').replace(/[^a-z-]/g, '').slice(0, 8);
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (!target || !/^https:\/\//.test(target)) {
    // The item dropped out of today's ranking: send them to the category.
    track(env, 'click_gone', cat, id, surface, '', lang);
    return new Response(null, { status: 302, headers: { ...headers, Location: `${lang === 'ja' ? '' : `/${lang}`}/c/${cat}/` } });
  }
  track(env, 'click', cat, id, surface, aiReferrer(request.headers.get('Referer')) || botOf(request.headers.get('User-Agent') || '')?.org || '', lang);
  return new Response(null, { status: 302, headers: { ...headers, Location: target } });
}

// A personal price watch without accounts: the item ids (and an optional
// price ceiling) live in the feed URL the user subscribes to. Nothing is
// stored. Entries point at SHELF pages, never straight at shops.
const LANG_PREFIX = { ja: '', en: 'en/', 'zh-hans': 'zh-hans/', 'zh-hant': 'zh-hant/', ko: 'ko/' };
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

async function watchFeed(env, url) {
  const asked = (url.searchParams.get('lang') || 'ja').toLowerCase();
  const lang = Object.hasOwn(LANG_PREFIX, asked) ? asked : 'ja';
  const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const below = Number(url.searchParams.get('below')) || null;
  if (!ids.length) return new Response('ids= is required (comma-separated SHELF item ids)', { status: 400 });
  let data;
  try {
    data = await (await asset(env, `${API_PREFIX}${LANG_PREFIX[lang]}items.json`)).json();
  } catch {
    return new Response('price data is unavailable right now', { status: 503, headers: { 'Retry-After': '600', ...CORS } });
  }
  const items = data.items || [];
  const base = `${url.origin}/${LANG_PREFIX[lang]}`;
  // The data's own timestamp, so readers do not see every entry as new on
  // each poll; an entry's id changes when its price does.
  const updated = data.updated_at ? new Date(data.updated_at).toISOString() : new Date().toISOString();
  const entries = ids
    .map((id) => items.find((x) => x.id === id))
    .filter(Boolean)
    .filter((x) => (below ? x.price <= below : ['lowest_observed', 'below_usual'].includes(x.verdict)))
    .map(
      (x) => `  <entry>
    <id>${xmlEsc(`${url.origin}/feed/watch#${x.id}@${x.price}`)}</id>
    <title>${xmlEsc(x.title)}</title>
    <link rel="alternate" href="${xmlEsc(`${base}c/${x.category}/`)}"/>
    <updated>${updated}</updated>
    <summary>${xmlEsc(`¥${x.price.toLocaleString('ja-JP')} — ${x.verdict_label ?? x.verdict}`)}</summary>
  </entry>`,
    );
  track(env, 'watch_feed', String(ids.length), below ? 'below' : 'verdict', '', '', lang);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEsc(url.href)}</id>
  <title>SHELF price watch</title>
  <link rel="self" href="${xmlEsc(url.href)}"/>
  <updated>${updated}</updated>
  <author><name>SHELF</name></author>
${entries.join('\n')}
</feed>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'max-age=3600', ...CORS } });
}

function wantsMarkdown(request) {
  const accept = request.headers.get('Accept') || '';
  const md = accept.indexOf('text/markdown');
  const html = accept.indexOf('text/html');
  return md >= 0 && (html < 0 || md < html);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/mcp' || path === '/mcp/') return mcp(request, env);
    if (path.startsWith('/go/')) return go(request, env, url);
    if (path === '/feed/watch.xml') return watchFeed(env, url);
    if (request.method === 'OPTIONS' && path.startsWith(API_PREFIX)) return new Response(null, { status: 204, headers: CORS });

    let res;
    const page = path.match(/^(\/(?:en|zh-hans|zh-hant|ko))?\/c\/([a-z0-9-]+)\/?$/);
    if (page && request.method === 'GET' && wantsMarkdown(request)) {
      res = await env.ASSETS.fetch(new Request(new URL(`${page[1] || ''}/c/${page[2]}.md`, url), request));
    } else {
      res = await env.ASSETS.fetch(request);
    }

    if (request.method === 'GET' && res.status === 200) {
      const bot = botOf(request.headers.get('User-Agent') || '');
      const kind = page && wantsMarkdown(request) ? 'md' : kindOf(path);
      if (bot) track(env, 'crawl', bot.name, bot.org, kind, path);
      else {
        const ref = aiReferrer(request.headers.get('Referer'));
        if (ref) track(env, 'ai_referral', ref, kind, path);
      }
    }

    const out = new Response(res.body, res);
    if (path.startsWith(API_PREFIX) || path.endsWith('.md') || path.endsWith('.txt')) {
      for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    }
    if (path.endsWith('.md') || (page && wantsMarkdown(request))) out.headers.set('Content-Type', 'text/markdown; charset=utf-8');
    if (path.endsWith('.txt')) out.headers.set('Content-Type', 'text/plain; charset=utf-8');
    return out;
  },
};
