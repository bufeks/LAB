#!/usr/bin/env node
// SHELF MCP server — lets an AI agent ask "what should I buy?" and "is now a
// good time to buy?" against SHELF's daily data. Zero dependencies, Node 18+,
// stdio transport (newline-delimited JSON-RPC 2.0).
//
//   curl -o shelf-mcp.mjs https://bufeks.github.io/LAB/shelf/mcp/server.mjs
//   claude mcp add shelf -- node /path/to/shelf-mcp.mjs
//
// Env: SHELF_API (default: the public API), SHELF_LOCAL_DIR (read JSON files
// from disk instead, for testing).
//
// The same file is the remote MCP endpoint: the SHELF Cloudflare Worker
// imports handle() and points setSource() at its static assets. Node-only
// modules are imported lazily so the Worker bundle does not need them.

const VERSION = '1.2.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ENV = globalThis.process?.env ?? {};
const API = (ENV.SHELF_API || 'https://bufeks.github.io/LAB/shelf/api/v1').replace(/\/$/, '');
const CACHE_MS = 10 * 60 * 1000;

let source = async (rel) => {
  if (ENV.SHELF_LOCAL_DIR) {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(`${ENV.SHELF_LOCAL_DIR}/${rel}`, 'utf8'));
  }
  const res = await fetch(`${API}/${rel}`, { headers: { 'User-Agent': `shelf-mcp/${VERSION}` } });
  if (!res.ok) throw new Error(`SHELF API ${res.status} for ${rel}`);
  return res.json();
};

// Where the JSON comes from: (rel) => parsed JSON for api/v1/<rel>.
export function setSource(fn) {
  source = fn;
  cache.clear();
}

// Tracked buy links (/go/...) carry the surface they were shown on; links
// handed out by this server count as "mcp".
function retag(value) {
  if (Array.isArray(value)) return value.map(retag);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === 'buy_url' && typeof v === 'string' && v.includes('/go/') ? v.replace(/([?&]s=)[a-z]+/, '$1mcp') : retag(v)]),
    );
  }
  return value;
}

const cache = new Map();
async function load(rel, { fresh = false } = {}) {
  const hit = cache.get(rel);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = retag(await source(rel));
  cache.set(rel, { at: Date.now(), data });
  return data;
}

class UserError extends Error {}

const yen = (n) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().trim();

// Answer languages and where their JSON lives (Japanese is unprefixed).
const LANGS = { ja: '', en: 'en/', 'zh-Hans': 'zh-hans/', 'zh-Hant': 'zh-hant/', ko: 'ko/' };
const LANG_ALIASES = { zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-hans': 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', 'zh-mo': 'zh-Hant', 'zh-hant': 'zh-Hant' };

// Explicit lang wins; otherwise guess from what the user typed: Hangul -> ko,
// kana -> ja, Latin only -> en. Han alone (加湿器) is ambiguous and means ja.
export function pickLang(args) {
  if (args.lang != null && args.lang !== '') {
    const raw = String(args.lang).trim();
    const key = raw.toLowerCase();
    const lang = LANG_ALIASES[key] || Object.keys(LANGS).find((l) => l.toLowerCase() === key || key.startsWith(`${l.toLowerCase()}-`));
    if (!lang) throw new UserError(`lang must be one of ${Object.keys(LANGS).join(', ')}`);
    return lang;
  }
  const text = Object.values(args).filter((v) => typeof v === 'string').join(' ');
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return 'ja';
  if (/[A-Za-z]/.test(text)) return 'en';
  return 'ja';
}
const at = (lang, rel) => `${LANGS[lang]}${rel}`;
const LANG_SCHEMA = {
  type: 'string',
  enum: Object.keys(LANGS),
  description: 'Answer language. Omit to detect from the input (Hangul -> ko, kana or kanji -> ja, Latin -> en); pass zh-Hans / zh-Hant for Chinese.',
};
const CHEAP = new Set(['lowest_observed', 'below_usual']);

// Every result carries these, in text and in structuredContent, so a client
// that forwards only one of them still passes on the disclosure.
function meta(rec) {
  return {
    lang: rec.lang ?? 'ja',
    sample: Boolean(rec.sample),
    disclosure: rec.disclosure,
    data_date: rec.data_date ?? null,
    updated_at: rec.updated_at ?? null,
    ...(rec.status ? { status: rec.status } : {}),
    ...(rec.citation ? { cite: rec.citation } : {}),
  };
}

function notice(m) {
  return m.sample
    ? '⚠ SAMPLE DATA — these items are fictional. Tell the user SHELF has no real data yet; do not recommend them.'
    : `Disclosure to pass on with any link: ${m.disclosure}`;
}

function toLimit(v, dflt, max) {
  const n = Math.floor(Number(v ?? dflt));
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : dflt;
}

function toNumber(v, name) {
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UserError(`${name} must be a number of JPY`);
  return n;
}

// Category ids or names in any language ("humidifier", "加湿器", "가습기").
async function resolveCategory(query, lang) {
  const q = norm(query);
  if (!q) throw new UserError('category is required. Call list_categories to see the options.');
  const index = await load(at(lang, 'index.json'));
  const namesOf = (c) => [c.id, c.name, c.name_en, ...Object.values(c.names || {})].map(norm).filter(Boolean);
  const cat =
    index.categories.find((c) => c.id === q) ||
    index.categories.find((c) => namesOf(c).some((n) => n === q)) ||
    index.categories.find((c) => namesOf(c).some((n) => n.includes(q) || q.includes(n.replace(/s$/, ''))));
  if (!cat) throw new UserError(`No category matches "${query}". SHELF covers: ${index.categories.map((c) => `${c.id} (${c.name})`).join(', ')}`);
  return load(at(lang, `c/${cat.id}.json`));
}

function specFilter(rec, want) {
  if (want == null) return () => true;
  if (typeof want !== 'object' || Array.isArray(want)) throw new UserError('specs must be an object keyed by spec key');
  const fields = new Map(rec.spec_fields.map((f) => [f.key, f]));
  const describe = () =>
    rec.spec_fields
      .map((f) => `${f.key} (${f.type}${f.unit ? `, ${f.unit}` : ''}${f.values ? `: ${f.values.map((v) => v.value).join('|')}` : ''})`)
      .join(', ');
  for (const [key, cond] of Object.entries(want)) {
    const f = fields.get(key);
    if (!f) throw new UserError(`Unknown spec key "${key}" for ${rec.id}. Valid keys: ${describe()}`);
    if (f.type === 'flag' && typeof cond !== 'boolean') throw new UserError(`${key} is a flag: use true or false`);
    if (f.type === 'enum') {
      const vals = [cond].flat();
      const bad = vals.find((v) => !f.values.some((o) => o.value === v));
      if (bad !== undefined) throw new UserError(`${key} must be one of ${f.values.map((o) => o.value).join(', ')}`);
    }
    if (f.type === 'number' && !(typeof cond === 'number' || (cond && typeof cond === 'object'))) {
      throw new UserError(`${key} is a number: pass a minimum like 10000, or {"min":..,"max":..}`);
    }
  }
  return (item) =>
    Object.entries(want).every(([key, cond]) => {
      const f = fields.get(key);
      const v = item.specs?.[key];
      if (f.type === 'flag') return Boolean(v) === cond;
      if (f.type === 'enum') return [cond].flat().includes(v);
      if (typeof v !== 'number') return false;
      if (typeof cond === 'number') return v >= cond;
      return (cond.min == null || v >= cond.min) && (cond.max == null || v <= cond.max);
    });
}

// Same rules as the site's picks, re-run on the filtered subset so a
// "best" pick never sits outside the user's budget.
function picksFor(items) {
  if (!items.length) return {};
  const scores = items.map((x) => x.score).sort((a, b) => a - b);
  const pos = (scores.length - 1) * 0.6;
  const cutoff = scores[Math.floor(pos)] + (scores[Math.ceil(pos)] - scores[Math.floor(pos)]) * (pos - Math.floor(pos));
  const picks = { best: items[0] };
  const value = items.filter((x) => x.score >= cutoff).sort((a, b) => a.price - b.price)[0];
  if (value && value.id !== items[0].id) picks.value = value;
  const deal = items
    .filter((x) => CHEAP.has(x.price_check.verdict) && !x.price_check.suspicious && !x.variants)
    .sort((a, b) => a.price / a.price_check.median_90d - b.price / b.price_check.median_90d)[0];
  if (deal) picks.deal = deal;
  return picks;
}

function specText(item, fields) {
  return (fields || [])
    .filter((f) => item.specs?.[f.key] != null && item.specs[f.key] !== false && f.key !== 'energy_wh_source')
    .map((f) => {
      const v = item.specs[f.key];
      if (f.type === 'flag') return f.label;
      if (f.values) return f.values.find((o) => o.value === v)?.label ?? v;
      return `${f.label}${v}${f.unit || ''}`;
    })
    .join(', ');
}

function line(x, fields) {
  const specs = specText(x, fields);
  const terms = `${x.shipping_included ? 'shipping included' : 'shipping extra'}${x.point_rate > 1 ? `, ${x.point_rate}x points` : ''}`;
  return (
    `#${x.rank} ${x.title} — ${yen(x.price)} (${terms}${x.store_name ? `, ${x.store_name}` : ''}), ★${x.rating} (${x.reviews} reviews), price: ${x.price_check.label}` +
    `${x.unit_price ? `, ${x.unit_price.label} ${x.unit_price.value}` : ''}` +
    `${x.sale_check ? `, sale claim: ${x.sale_check.label}` : ''}` +
    `${x.variants ? ' [pick-a-variant listing: price may be the cheapest option]' : ''}` +
    `${specs ? `\n   specs (from title): ${specs}` : ''}\n   id: ${x.id}\n   buy (affiliate): ${x.buy_url}` +
    `${x.cheapest_offer ? `\n   cheaper at ${x.cheapest_offer.store_name}: ${yen(x.cheapest_offer.price)} ${x.cheapest_offer.buy_url}` : ''}`
  );
}

function itemIdFromUrl(u) {
  try {
    const url = new URL(u);
    if (!/(^|\.)item\.rakuten\.co\.jp$/.test(url.hostname)) return null;
    const [shop, code] = url.pathname.split('/').filter(Boolean);
    return shop && code ? `rakuten:${shop}:${code}` : null;
  } catch {
    return null;
  }
}

const ADVICE = {
  insufficient_data: 'Not enough history yet (under 7 days observed). Do not call it a deal.',
  lowest_observed: 'At the lowest price SHELF has observed, and clearly under its usual price. A good time to buy if the user needs it.',
  below_usual: 'Cheaper than usual (at least 10% under its median).',
  usual: 'Around its usual price. No reason to wait, no reason to rush.',
  above_usual: 'More expensive than usual (10%+ over its median). Suggest waiting or an alternative.',
};

const TOOLS = [
  {
    name: 'list_categories',
    description: 'List the shopping categories SHELF covers (Japan, Rakuten Ichiba), each with its current top pick. Call first when unsure which category fits.',
    inputSchema: { type: 'object', properties: { lang: LANG_SCHEMA } },
    async run(args) {
      const index = await load(at(pickLang(args), 'index.json'));
      const m = meta(index);
      const text = index.categories
        .map((c) => `- ${c.id} (${c.name} / ${c.name_en}): ${c.best ? `top pick ${c.best.title} ${yen(c.best.price)}` : 'no data'} [${c.status}, data ${c.data_date}]`)
        .join('\n');
      return { meta: m, text, data: index.categories };
    },
  },
  {
    name: 'recommend',
    description:
      'Recommend products in one category for a shopper in Japan: returns the buying guide (what matters and why), picks computed within the ' +
      "user's budget/spec filters (best, value, deal), and ranked items. Use the guide to explain the choice and cite the source URL.",
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category id or name, e.g. "mobile-battery", "加湿器", "kettle". See list_categories.' },
        budget_max: { type: 'number', description: 'Maximum price in JPY' },
        budget_min: { type: 'number', description: 'Minimum price in JPY' },
        specs: {
          type: 'object',
          description:
            'Filters by spec key (valid keys are listed in every recommend result). Flags: true/false. Numbers: a minimum like 10000, or {"min":..,"max":..}. ' +
            'Enums: a value or list. Examples: {"capacity_mah":10000,"pse":true,"flight_carry_on":"ok"}, {"type":["steam","hybrid"]}',
        },
        limit: { type: 'number', description: 'Max items to return (default 5, max 20)' },
        sort: { type: 'string', enum: ['rank', 'unit_price', 'price'], description: 'rank (default), unit_price (consumables: cheapest per kg/L/piece first; furusato: most per 10,000 yen first) or price' },
        lang: LANG_SCHEMA,
      },
      required: ['category'],
    },
    async run(args) {
      const rec = await resolveCategory(args.category, pickLang(args));
      const max = toNumber(args.budget_max, 'budget_max');
      const min = toNumber(args.budget_min, 'budget_min');
      const matches = rec.items
        .filter((x) => (max == null || x.price <= max) && (min == null || x.price >= min))
        .filter(specFilter(rec, args.specs));
      if (args.sort === 'unit_price') {
        if (!rec.unit_rule) throw new UserError(`${rec.id} has no unit price; sort by rank or price instead.`);
        const dir = rec.unit_rule.higher_is_better ? -1 : 1;
        matches.sort((a, b) => (a.unit_price ? (b.unit_price ? dir * (a.unit_price.value - b.unit_price.value) : -1) : 1));
      } else if (args.sort === 'price') matches.sort((a, b) => a.price - b.price);
      const shown = matches.slice(0, toLimit(args.limit, 5, 20));
      const picks = picksFor(matches);
      const pickText = Object.entries(picks)
        .map(([k, x]) => `- ${k}: ${x.title} ${yen(x.price)} (id ${x.id})`)
        .join('\n');
      const m = meta(rec);
      const text = [
        `# ${rec.name} (data ${rec.data_date}, status ${rec.status})`,
        rec.how_to_choose.summary,
        `## Buying guide${rec.how_to_choose.asOf ? ` (as of ${rec.how_to_choose.asOf})` : ''}\n${rec.how_to_choose.criteria.map((c) => `- ${c.name}: ${c.detail}`).join('\n')}`,
        `## Pitfalls\n${rec.how_to_choose.pitfalls.map((p) => `- ${p}`).join('\n')}`,
        ...(rec.market?.for_visitors ? [`## Buying from outside Japan\n${rec.market.for_visitors}${rec.how_to_choose.abroad ? `\n${rec.how_to_choose.abroad}` : ''}`] : []),
        `## Is now a good time? ${rec.price_outlook.summary}`,
        `## Picks within these filters\n${pickText || 'none'}`,
        `## Matching items (${shown.length} of ${matches.length})\n${shown.map((x) => line(x, rec.spec_fields)).join('\n') || 'Nothing matches these filters; relax the budget or specs.'}`,
        `Specs are parsed from listing titles; tell the user to confirm on the product page. Spec keys: ${rec.spec_fields.map((f) => f.key).join(', ')}`,
      ].join('\n\n');
      return {
        meta: m,
        text,
        data: {
          category: rec.id,
          picks: Object.fromEntries(Object.entries(picks).map(([k, x]) => [k, x.id])),
          price_outlook: rec.price_outlook,
          items: shown,
          total_matches: matches.length,
          spec_fields: rec.spec_fields,
        },
      };
    },
  },
  {
    name: 'price_outlook',
    description: 'Answer "is now a good time to buy <category>?" from SHELF daily price history: share of top items cheaper/pricier than usual, plus the items currently under their usual price.',
    inputSchema: { type: 'object', properties: { category: { type: 'string' }, lang: LANG_SCHEMA }, required: ['category'] },
    async run(args) {
      const rec = await resolveCategory(args.category, pickLang(args));
      const cheap = rec.items.filter((x) => CHEAP.has(x.price_check.verdict) && !x.price_check.suspicious);
      const text = [
        `# ${rec.name}: ${rec.price_outlook.verdict}`,
        rec.price_outlook.summary,
        cheap.length ? `## Currently under their usual price\n${cheap.map((x) => line(x, rec.spec_fields)).join('\n')}` : 'No ranked item is under its usual price right now.',
      ].join('\n\n');
      return { meta: meta(rec), text, data: { outlook: rec.price_outlook, cheaper_items: cheap } };
    },
  },
  {
    name: 'search_products',
    description: 'Search all SHELF items by words in the product title (usually Japanese) or category id, optionally under a budget.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words that must all appear, e.g. "20000mAh 65W"' },
        budget_max: { type: 'number' },
        limit: { type: 'number', description: 'default 10, max 30' },
        lang: LANG_SCHEMA,
      },
      required: ['query'],
    },
    async run(args) {
      const words = norm(args.query).split(/\s+/).filter(Boolean);
      if (!words.length) throw new UserError('query is required');
      const max = toNumber(args.budget_max, 'budget_max');
      const all = await load(at(pickLang(args), 'items.json'));
      const hits = all.items
        .filter((x) => words.every((w) => norm(`${x.title} ${x.category} ${x.category_name ?? ''}`).includes(w)))
        .filter((x) => max == null || x.price <= max)
        .sort((a, b) => b.score - a.score)
        .slice(0, toLimit(args.limit, 10, 30));
      const text = hits.length
        ? hits
            .map((x) => `[${x.category}] #${x.rank} ${x.title} — ${yen(x.price)}, ★${x.rating} (${x.reviews}), price: ${x.verdict}\n   id: ${x.id}\n   buy (affiliate): ${x.buy_url}`)
            .join('\n')
        : `No items match "${args.query}". Try list_categories and recommend.`;
      return { meta: meta(all), text, data: hits };
    },
  },
  {
    name: 'check_price',
    description:
      "Tell whether an item's current price is good compared with its own recent history (SHELF records prices daily). " +
      'Takes an item id from recommend/search_products, or a Rakuten item URL (https://item.rakuten.co.jp/<shop>/<item>/).',
    inputSchema: { type: 'object', properties: { item_id: { type: 'string' }, url: { type: 'string' }, lang: LANG_SCHEMA } },
    async run(args) {
      const id = args.item_id || itemIdFromUrl(args.url);
      if (!id) throw new UserError('Pass item_id, or a Rakuten item URL as url.');
      // Ids and URLs carry no language: default to English unless asked.
      const lang = args.lang ? pickLang({ lang: args.lang }) : 'en';
      let all = await load(at(lang, 'items.json'));
      let entry = all.items.find((i) => i.id === id);
      if (!entry) {
        all = await load(at(lang, 'items.json'), { fresh: true });
        entry = all.items.find((i) => i.id === id);
      }
      if (!entry) throw new UserError(`SHELF does not track ${id} (only ranked items in its categories are tracked).`);
      let rec = await load(at(lang, `c/${entry.category}.json`));
      let x = rec.items.find((i) => i.id === id);
      if (!x) {
        rec = await load(at(lang, `c/${entry.category}.json`), { fresh: true });
        x = rec.items.find((i) => i.id === id);
      }
      if (!x) throw new UserError(`${id} dropped out of the ${entry.category} ranking in today's update.`);
      const pc = x.price_check;
      const text = [
        `${x.title} — now ${yen(x.price)} (${x.shipping_included ? 'shipping included' : 'shipping extra'}, ${x.point_rate}x points)`,
        `Verdict: ${pc.verdict} (${pc.label}) — ${ADVICE[pc.verdict]}` +
          `${pc.suspicious ? ' Price is far below usual: it may be a listing error or a different variant, so check the page.' : ''}` +
          `${x.variants ? ' This listing lets the buyer pick a variant; the price may be for the cheapest option.' : ''}`,
        pc.median_90d
          ? `Observed ${pc.observed_days} days over ${pc.window_days} (since ${pc.first_seen}): min ${yen(pc.min_90d)}, median ${yen(pc.median_90d)}, max ${yen(pc.max_90d)}`
          : `Observed ${pc.observed_days} days so far.`,
        pc.weekly_low?.length ? `Weekly lows: ${pc.weekly_low.map(([d, p]) => `${d} ${yen(p)}`).join(', ')}` : '',
        x.other_offers?.length ? `Same product at other shops: ${x.other_offers.map((o) => `${o.shop} ${yen(o.price)}`).join(', ')}` : '',
        `buy (affiliate): ${x.buy_url}`,
      ]
        .filter(Boolean)
        .join('\n');
      return { meta: meta(rec), text, data: { item: x, advice: ADVICE[pc.verdict] } };
    },
  },
];

// Tools beyond product categories.
TOOLS.push(
  {
    name: 'check_compatibility',
    description:
      'Which genuine replacement brush heads fit an electric toothbrush handle (Philips Sonicare, Braun Oral-B), from its model number (e.g. HX6859, D305, iO9) or name. ' +
      'Only manufacturer-stated rules are used, with the quoted source; unknown handles are not guessed.',
    inputSchema: { type: 'object', properties: { model: { type: 'string', description: 'Model number or product name' }, lang: LANG_SCHEMA }, required: ['model'] },
    async run(args) {
      const input = String(args.model ?? '').normalize('NFKC').trim();
      if (!input) throw new UserError('model is required');
      const c = await load(at(pickLang(args), 'compat.json'));
      const model = input.toUpperCase().replace(/[\s-]/g, '');
      const rule = c.rules.find((r) => (r.match.model && new RegExp(r.match.model).test(model)) || (r.match.name && new RegExp(r.match.name, 'i').test(input)));
      if (!rule) return { meta: meta(c), text: `No rule matches "${input}". ${c.unknown}`, data: { input, verdict: 'unknown' } };
      const text = [
        `${input}: ${rule.heads} (${rule.confidence_label})`,
        `Manufacturer: “${rule.source.quote}” — ${rule.source.url}`,
        rule.head_category ? `Genuine heads compared per head: ${rule.head_category.page}` : '',
        rule.cheapest_per_head ? `Cheapest genuine per head now: ${rule.cheapest_per_head.title} — ${rule.cheapest_per_head.unit_price.label} ${yen(rule.cheapest_per_head.unit_price.value)} (affiliate) ${rule.cheapest_per_head.buy_url}` : '',
        rule.confidence === 'check' ? 'This rule varies by model: tell the user to confirm with the maker before buying.' : '',
      ].filter(Boolean).join('\n');
      return { meta: meta(c), text, data: { input, rule } };
    },
  },
  {
    name: 'sale_check',
    description:
      'Check discount claims in listing titles ("50%OFF", "半額") against each item’s own recorded price history: genuine, smaller than claimed, not lower than usual, coupon-only, or unverified. Also lists shopping events running today.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category id or name' },
        verdict: { type: 'string', enum: ['genuine', 'smaller_than_claimed', 'not_lower_than_usual', 'coupon', 'unverified'] },
        lang: LANG_SCHEMA,
      },
    },
    async run(args) {
      const lang = pickLang(args);
      const sale = await load(at(lang, 'sale.json'));
      let items = sale.items;
      if (args.category) {
        const rec = await resolveCategory(args.category, lang);
        items = items.filter((i) => i.category === rec.id);
      }
      if (args.verdict) items = items.filter((i) => i.verdict === args.verdict);
      const events = sale.events.length ? sale.events.map((e) => `- ${e.label}: ${e.note}`).join('\n') : 'No major sale detected today.';
      const list = items
        .slice(0, 20)
        .map((i) => `- [${i.label}] ${i.title} — ${yen(i.price)}; claims ${i.claimed_pct != null ? `${i.claimed_up_to ? 'up to ' : ''}${i.claimed_pct}%` : yen(i.claimed_yen)} off${i.actual_drop_pct != null ? `; actually ${i.actual_drop_pct}% under its usual ${yen(i.median_90d)}` : ''}\n  ${i.page}`)
        .join('\n');
      return { meta: meta(sale), text: `## Events today\n${events}\n\n## Discount claims (${items.length})\n${list || 'none'}\n\nMethod: ${sale.method}`, data: { events: sale.events, items } };
    },
  },
  {
    name: 'hotel_outlook',
    description:
      'Hotel prices in major Japanese areas (Tokyo Shinjuku, Tokyo Station, Kyoto, Osaka Namba, Sapporo, Fukuoka Hakata, Naha) for coming Friday/Saturday nights: the area price level, rooms left, and whether prices for that night are rising or falling (book now or wait). 2 adults, 1 room.',
    inputSchema: {
      type: 'object',
      properties: { area: { type: 'string', description: 'Area id or name, e.g. "kyoto", "新宿", "Osaka"' }, date: { type: 'string', description: 'Night (YYYY-MM-DD), optional' }, lang: LANG_SCHEMA },
    },
    async run(args) {
      const h = await load(at(pickLang(args), 'hotels.json'));
      const q = norm(args.area);
      const areas = q ? h.areas.filter((a) => norm(a.id).includes(q) || norm(a.name).includes(q) || q.includes(norm(a.id).split('-')[0])) : h.areas;
      if (q && !areas.length) throw new UserError(`No area matches "${args.area}". Areas: ${h.areas.map((a) => `${a.id} (${a.name})`).join(', ')}`);
      const text = areas
        .map((a) => {
          const nights = a.nights.filter((n) => !args.date || n.date === args.date);
          return `## ${a.name}\n${nights.map((n) => `- ${n.date} (${n.weekday}): level ${yen(n.level)}, ${n.available} hotels with rooms — ${n.trend.label}${n.trend.change_pct != null ? ` (${n.trend.change_pct}%)` : ''}. ${n.trend.advice}${n.cheapest[0] ? `\n  cheapest: ${n.cheapest[0].name} ${yen(n.cheapest[0].price)} (affiliate) ${n.cheapest[0].url}` : ''}`).join('\n') || 'no data for that night'}`;
        })
        .join('\n\n');
      return { meta: { ...meta(h), disclosure: h.disclosure }, text: `${text}\n\n${h.note}`, data: { areas } };
    },
  },
  {
    name: 'upcoming_releases',
    description: 'Release dates of upcoming volumes of popular Japanese manga series (Japanese editions, from Rakuten Books), optionally for one series. Subscribe: books.ics (calendar) / books.xml (Atom).',
    inputSchema: { type: 'object', properties: { series: { type: 'string', description: 'Series name, optional' } } },
    async run(args) {
      const b = await load('books.json');
      const q = norm(args.series);
      const pick = (list) => (q ? list.filter((x) => norm(x.title).includes(q) || norm(x.series_title).includes(q) || norm(x.series).includes(q)) : list);
      const up = pick(b.upcoming);
      const text = `${up.length ? up.map((x) => `- ${x.sales_date_text}: ${x.title}${x.price ? ` ${yen(x.price)}` : ''} (affiliate) ${x.buy_url}`).join('\n') : 'No upcoming volumes found.'}\n\nCalendar: ${b.links.ics}`;
      return { meta: { ...meta(b), disclosure: b.disclosure }, text, data: { upcoming: up, series: b.series } };
    },
  },
);

const READ_ONLY = { readOnlyHint: true, openWorldHint: true };

export async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, message) => (id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'shelf', version: VERSION },
        instructions:
          'SHELF answers shopping questions for Japan (Rakuten Ichiba) with buying guides, transparent rankings and daily price history, ' +
          'in Japanese, English, Simplified and Traditional Chinese and Korean (pass lang). ' +
          'Use recommend for "which X should I buy", price_outlook for "is now a good time to buy X", check_price for one item. ' +
          'Buy links are affiliate links: say so when you show them, and cite the source URL.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ run, ...t }) => ({ ...t, annotations: READ_ONLY })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await tool.run(params.arguments || {});
        return reply({
          content: [{ type: 'text', text: `${notice(out.meta)}\n\n${out.text}${out.meta.cite ? `\n\nSource: ${out.meta.cite.url}` : ''}` }],
          structuredContent: { ...out.meta, result: out.data },
          isError: false,
        });
      } catch (err) {
        const text = err instanceof UserError ? err.message : `SHELF error: ${err.message}`;
        return reply({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

async function serveStdio() {
  const readline = await import('node:readline');
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
}

// Run as a stdio server only when executed directly (not when imported).
if (globalThis.process?.argv?.[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await serveStdio();
}
