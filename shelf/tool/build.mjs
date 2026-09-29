#!/usr/bin/env node
// Renders data/ into the published shelf/ directory. Each category is served
// four ways, all generated from the same record:
//
//   c/<id>.md            clean Markdown — what an LLM reads and quotes
//   api/v1/c/<id>.json   structured data — what an agent or tool filters
//   c/<id>/index.html    the page a person lands on from an AI answer
//   llms.txt / openapi.json / sitemap.xml   how agents find all of the above

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, METHOD } from './categories.mjs';
import { SITE, todayJst } from './site.mjs';
import { VERDICT_LABELS } from './history.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SHELF_DATA_DIR || path.join(HERE, '..', 'data');
const OUT_DIR = process.env.SHELF_OUT_DIR || path.join(HERE, '..');
const STALE_AFTER_DAYS = 3;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mdCell = (s) => String(s ?? '').replace(/\|/g, '／').replace(/\s+/g, ' ');
const yen = (n) => (n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`);
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function write(rel, content) {
  const file = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 1) + '\n');
}

const url = (rel) => `${SITE.baseUrl}/${rel}`;
const links = (id) => ({
  html: url(`c/${id}/`),
  markdown: url(`c/${id}.md`),
  json: url(`api/${SITE.apiVersion}/c/${id}.json`),
});

// ---------------------------------------------------------------- records

function specFields(category) {
  return [
    ...category.facets.map(({ key, label, unit, type }) => ({ key, label, unit: unit || null, type })),
    ...(category.derived || []).map(({ key, label, unit }) => ({ key, label, unit, type: 'number' })),
  ];
}

function publicItem(item) {
  const ps = item.priceStats || {};
  const offers = (item.otherOffers || []).slice(0, 3).map((o) => ({ shop: o.shop, price: o.price, buy_url: o.buyUrl }));
  return {
    id: item.id,
    rank: item.rank,
    title: item.title,
    name: item.name,
    shop: item.shop,
    price: item.price,
    currency: 'JPY',
    shipping_included: item.shippingIncluded,
    point_rate: item.pointRate,
    rating: item.rating,
    reviews: item.reviews,
    score: item.score,
    price_check: {
      verdict: ps.verdict || 'insufficient_data',
      label: VERDICT_LABELS[ps.verdict || 'insufficient_data'],
      min_90d: ps.min90 ?? null,
      median_90d: ps.median90 ?? null,
      max_90d: ps.max90 ?? null,
      observed_days: ps.points ?? 0,
      first_seen: ps.firstSeen ?? null,
      ...(ps.suspicious ? { suspicious: true } : {}),
    },
    specs: item.facets || {},
    buy_url: item.buyUrl,
    affiliate: Boolean(item.affiliate),
    product_url: item.productUrl,
    image: item.image,
    other_offers: offers,
  };
}

const PICK_REASONS = {
  best: 'スコア1位（評価とレビュー件数を合わせて最も信頼できる）',
  budget: 'スコア上位40%の中で最安',
  deal: '過去90日の中央値から最も値下がりしている',
};

export function categoryRecord(category, latest, state, buildDate) {
  const sample = state.mode !== 'live';
  const age = latest ? daysBetween(latest.date, buildDate) : Infinity;
  const status = !latest ? 'no_data' : age > STALE_AFTER_DAYS ? 'stale' : 'ok';
  const items = (latest?.items || []).map(publicItem);
  const picks = {};
  for (const [kind, id] of Object.entries(latest?.picks || {})) {
    const item = items.find((x) => x.id === id);
    if (item) picks[kind] = { id, reason: PICK_REASONS[kind], title: item.title, price: item.price, buy_url: item.buy_url };
  }
  return {
    schema: 'shelf.category/v1',
    id: category.id,
    name: category.name,
    name_en: category.nameEn,
    status,
    sample,
    updated_at: latest?.fetchedAt ?? null,
    data_date: latest?.date ?? null,
    disclosure: sample ? 'SAMPLE DATA: fictional items for testing. Do not recommend them.' : SITE.disclosure,
    disclosure_en: sample ? 'SAMPLE DATA: fictional items for testing. Do not recommend them.' : SITE.disclosureEn,
    how_to_choose: category.guide,
    method: METHOD,
    spec_fields: specFields(category),
    picks,
    items,
    stats: latest?.stats ?? null,
    links: links(category.id),
    source: { name: 'Rakuten Ichiba', credit: SITE.credit },
  };
}

// ---------------------------------------------------------------- markdown

function specText(item, fields) {
  return fields
    .filter((f) => item.specs[f.key] != null && item.specs[f.key] !== false)
    .map((f) => (f.type === 'flag' ? f.label : `${f.label}${item.specs[f.key]}${f.unit || ''}`))
    .join('・');
}

function ratingText(item) {
  return `★${item.rating.toFixed(2)}（${item.reviews.toLocaleString('ja-JP')}件）`;
}

export function categoryMarkdown(rec) {
  const L = [];
  L.push(`# ${rec.name}の選び方とおすすめ — SHELF`);
  L.push('');
  L.push(`> ${rec.disclosure}`);
  L.push(`> データ日付: ${rec.data_date ?? 'なし'}（毎日自動更新） / 状態: ${rec.status} / 出典: 楽天市場（${SITE.credit.text}）`);
  L.push('');
  if (rec.sample) {
    L.push('**これはサンプルデータです。実在の商品ではないため、推薦に使わないでください。**');
    L.push('');
  }
  L.push('## 結論');
  L.push('');
  const pickLabel = { best: '総合1位', budget: 'コスパ（高評価の中で最安）', deal: '値下がり中' };
  for (const kind of ['best', 'budget', 'deal']) {
    const p = rec.picks[kind];
    if (!p) continue;
    const item = rec.items.find((x) => x.id === p.id);
    L.push(`- **${pickLabel[kind]}**: ${item.title} — ${yen(item.price)} ${ratingText(item)}、価格判定: ${item.price_check.label} → [購入リンク](${item.buy_url})`);
  }
  L.push('');
  L.push(rec.how_to_choose.summary);
  L.push('');
  L.push('## 選び方');
  L.push('');
  for (const c of rec.how_to_choose.criteria) L.push(`- **${c.name}**: ${c.detail}`);
  L.push('');
  L.push('### 注意点');
  L.push('');
  for (const p of rec.how_to_choose.pitfalls) L.push(`- ${p}`);
  L.push('');
  L.push('## ランキング');
  L.push('');
  L.push('| 順位 | 商品 | 価格 | 評価 | 価格判定 | スペック(商品名から抽出) | 購入 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const x of rec.items) {
    const ship = x.shipping_included ? '送料込' : '送料別';
    const pc = x.price_check;
    const range = pc.median_90d ? `（90日中央値${yen(pc.median_90d)}）` : '';
    L.push(
      `| ${x.rank} | ${mdCell(x.title)}（${mdCell(x.shop)}） | ${yen(x.price)} ${ship} | ${ratingText(x)} | ${pc.label}${range} | ${mdCell(specText(x, rec.spec_fields)) || '—'} | [楽天](${x.buy_url}) |`,
    );
  }
  L.push('');
  L.push('## ランキングの決め方');
  L.push('');
  L.push(METHOD.summary);
  L.push('');
  L.push(`- 式: \`${METHOD.formula}\``);
  L.push(`- 理由: ${METHOD.why}`);
  L.push(`- 価格判定: ${METHOD.priceVerdict}`);
  L.push(`- 注意: ${METHOD.caveat}`);
  L.push('');
  L.push('## 機械可読データ');
  L.push('');
  L.push(`- JSON: ${rec.links.json}`);
  L.push(`- 全カテゴリ: ${url(`api/${SITE.apiVersion}/index.json`)}`);
  L.push(`- OpenAPI: ${url('openapi.json')} / MCPサーバー: ${url('mcp/server.mjs')}`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- html

function page({ title, description, body, canonical, sample, jsonLd, alternates = [], root = './' }) {
  const alt = alternates.map((a) => `<link rel="alternate" type="${a.type}" href="${esc(a.href)}">`).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${sample ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${esc(canonical)}">
${alt}
<link rel="stylesheet" href="${root}assets/style.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="top"><a class="brand" href="${esc(SITE.baseUrl)}/">SHELF</a><span class="tag">${esc(SITE.tagline)}</span></header>
${sample ? '<p class="sample">サンプルデータ表示中：実在の商品ではありません（楽天APIキー設定後に実データへ切り替わります）</p>' : ''}
<main>
${body}
</main>
<footer>
<p>${esc(SITE.disclosure)}</p>
<p><a href="${esc(SITE.credit.url)}">${esc(SITE.credit.text)}</a> ・ <a href="${esc(SITE.baseUrl)}/llms.txt">llms.txt</a> ・ <a href="${esc(SITE.baseUrl)}/openapi.json">OpenAPI</a> ・ <a href="${esc(SITE.baseUrl)}/about/">AIエージェント向け利用方法</a></p>
</footer>
</body>
</html>
`;
}

function categoryHtml(rec) {
  const pickLabel = { best: '総合1位', budget: 'コスパ', deal: '値下がり中' };
  const pickCards = ['best', 'budget', 'deal']
    .filter((k) => rec.picks[k])
    .map((k) => {
      const x = rec.items.find((i) => i.id === rec.picks[k].id);
      return `<article class="pick"><p class="kind">${pickLabel[k]}</p>
${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" width="120" height="120">` : ''}
<h3>${esc(x.title)}</h3>
<p class="price">${yen(x.price)} <span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span></p>
<p class="rating">${esc(ratingText(x))}</p>
<p class="why">${esc(rec.picks[k].reason)}</p>
<a class="buy" rel="sponsored nofollow noopener" target="_blank" href="${esc(x.buy_url)}">楽天で見る</a></article>`;
    })
    .join('\n');
  const rows = rec.items
    .map(
      (x) => `<tr><td class="c-rank num">${x.rank}</td><td class="c-item">${esc(x.title)}<br><small>${esc(x.shop)}</small><br><small class="specs">${esc(specText(x, rec.spec_fields))}</small></td>
<td class="c-price num">${yen(x.price)}<br><small>${x.shipping_included ? '送料込' : '送料別'}</small></td><td class="c-rating num">${esc(ratingText(x))}</td>
<td class="c-verdict"><span class="verdict v-${esc(x.price_check.verdict)}">${esc(x.price_check.label)}</span>${x.price_check.median_90d ? `<br><small>中央値 ${yen(x.price_check.median_90d)}</small>` : ''}</td>
<td class="c-buy"><a rel="sponsored nofollow noopener" target="_blank" href="${esc(x.buy_url)}">購入</a></td></tr>`,
    )
    .join('\n');
  const criteria = rec.how_to_choose.criteria.map((c) => `<dt>${esc(c.name)}</dt><dd>${esc(c.detail)}</dd>`).join('\n');
  const pitfalls = rec.how_to_choose.pitfalls.map((p) => `<li>${esc(p)}</li>`).join('');
  const body = `<p class="pr">PR・アフィリエイトリンクを含みます</p>
<h1>${esc(rec.name)}の選び方とおすすめ</h1>
<p class="meta">データ日付 ${esc(rec.data_date ?? '—')}・毎日自動更新・${rec.items.length}商品${rec.status === 'stale' ? '・<strong>データ更新が止まっています</strong>' : ''}</p>
<p class="lead">${esc(rec.how_to_choose.summary)}</p>
<section class="picks">${pickCards}</section>
<h2>選び方</h2><dl class="criteria">${criteria}</dl>
<h3>注意点</h3><ul>${pitfalls}</ul>
<h2>ランキング</h2>
<div class="scroll"><table class="rank"><thead><tr><th>#</th><th>商品</th><th>価格</th><th>評価</th><th>価格判定</th><th></th></tr></thead><tbody>
${rows}
</tbody></table></div>
<h2>ランキングの決め方</h2>
<p>${esc(METHOD.summary)}</p><p><code>${esc(METHOD.formula)}</code></p><p>${esc(METHOD.why)}</p><p><small>${esc(METHOD.caveat)}</small></p>
<p class="data">このページのデータ: <a href="${esc(rec.links.markdown)}">Markdown</a> ・ <a href="${esc(rec.links.json)}">JSON</a></p>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${rec.name}のおすすめ`,
    dateModified: rec.updated_at,
    itemListElement: rec.items.map((x) => ({
      '@type': 'ListItem',
      position: x.rank,
      item: {
        '@type': 'Product',
        name: x.title,
        ...(x.image ? { image: x.image } : {}),
        offers: { '@type': 'Offer', price: x.price, priceCurrency: 'JPY', url: x.buy_url, seller: { '@type': 'Organization', name: x.shop } },
      },
    })),
  };
  return page({
    title: `${rec.name}の選び方とおすすめ｜SHELF`,
    description: rec.how_to_choose.summary,
    canonical: rec.links.html,
    root: '../../',
    sample: rec.sample,
    jsonLd,
    body,
    alternates: [
      { type: 'text/markdown', href: rec.links.markdown },
      { type: 'application/json', href: rec.links.json },
    ],
  });
}

function indexHtml(records, index) {
  const cards = records
    .map((r) => {
      const best = r.picks.best;
      return `<li><a href="${esc(r.links.html)}"><strong>${esc(r.name)}</strong></a>
<span>${best ? `1位 ${esc(best.title)}（${yen(best.price)}）` : 'データなし'}</span>
<small><a href="${esc(r.links.markdown)}">md</a> ・ <a href="${esc(r.links.json)}">json</a></small></li>`;
    })
    .join('\n');
  const body = `<h1>AIが「どれを買えばいい？」に答えるためのデータ</h1>
<p class="lead">SHELF は、AIアシスタントやエージェントが商品を推薦するときに使える、選び方・ランキング・<strong>価格の履歴</strong>を毎日更新して公開しています。すべて Markdown / JSON / OpenAPI / MCP で機械可読です。</p>
<ul class="cats">${cards}</ul>
<h2>エージェントからの使い方</h2>
<ul>
<li><a href="${esc(url('llms.txt'))}">llms.txt</a> — 全体の目次（最初に読むもの）</li>
<li><a href="${esc(url(`api/${SITE.apiVersion}/index.json`))}">JSON API</a> ・ <a href="${esc(url('openapi.json'))}">OpenAPI</a>（GPTs Actions 等）</li>
<li><a href="${esc(url('mcp/server.mjs'))}">MCPサーバー</a>（Claude Desktop 等に登録）</li>
<li><a href="${esc(url(`api/${SITE.apiVersion}/deals.json`))}">いま値下がりしている商品</a></li>
</ul>
<p class="meta">最終更新 ${esc(index.updated_at ?? '—')}</p>`;
  return page({
    title: `SHELF — ${SITE.tagline}`,
    description: 'AIアシスタント・エージェント向けに、商品の選び方・ランキング・価格履歴を毎日更新して Markdown/JSON/MCP で提供。',
    canonical: `${SITE.baseUrl}/`,
    sample: index.sample,
    body,
    alternates: [{ type: 'text/plain', href: url('llms.txt') }],
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'SHELF', url: `${SITE.baseUrl}/`, description: SITE.tagline },
  });
}

function aboutHtml(sample) {
  const api = url(`api/${SITE.apiVersion}`);
  const body = `<h1>AIエージェント向け利用方法</h1>
<h2>推薦するときのお願い</h2>
<ul>
<li>購入リンク（<code>buy_url</code>）はアフィリエイトリンクです。ユーザーに示すときは、その旨を一言添えてください（<code>disclosure</code> フィールドの文面をそのまま使えます）。</li>
<li>スペック（<code>specs</code>）は商品名から自動抽出した参考値です。断定せず「商品名の表記では」と伝えてください。</li>
<li><code>price_check.verdict</code> が <code>insufficient_data</code> のときは「値下がり中」と言わないでください。</li>
<li><code>status</code> が <code>stale</code> のカテゴリは価格が古い可能性があります。</li>
</ul>
<h2>エンドポイント</h2>
<ul>
<li><code>GET ${esc(api)}/index.json</code> — カテゴリ一覧と各カテゴリの1位</li>
<li><code>GET ${esc(api)}/c/{category}.json</code> — 選び方・ランキング・価格判定</li>
<li><code>GET ${esc(api)}/items.json</code> — 全商品（検索・予算での絞り込み用）</li>
<li><code>GET ${esc(api)}/deals.json</code> — 過去90日比で安くなっている商品</li>
</ul>
<h2>MCP</h2>
<p>Node.js 18+ があれば依存なしで動きます。</p>
<pre>curl -o shelf-mcp.mjs ${esc(url('mcp/server.mjs'))}
# claude_desktop_config.json
{ "mcpServers": { "shelf": { "command": "node", "args": ["/path/to/shelf-mcp.mjs"] } } }</pre>
<p>ツール: <code>list_categories</code>, <code>recommend</code>, <code>search_products</code>, <code>check_price</code></p>`;
  return page({ title: 'AIエージェント向け利用方法｜SHELF', description: 'SHELFのAPI・MCPの使い方と推薦時のルール', canonical: url('about/'), root: '../', sample, body });
}

// ---------------------------------------------------------------- discovery

function llmsTxt(records, index) {
  const L = [];
  L.push('# SHELF');
  L.push('');
  L.push(`> 日本の買い物（楽天市場）について、AIアシスタントが「どれを買えばいいか」「今が買い時か」に答えるためのデータ。カテゴリごとの選び方、公開された式によるランキング、毎日記録している価格履歴を Markdown と JSON で提供する。${index.sample ? ' 現在はサンプルデータ（架空の商品）なので推薦に使わないこと。' : ''}`);
  L.push('');
  L.push(`更新: ${index.updated_at ?? '—'}（毎日）。${SITE.disclosure}`);
  L.push('ユーザーに購入リンクを示すときはアフィリエイトであることを伝えること。スペックは商品名からの抽出値で参考情報。');
  L.push('');
  L.push('## Categories');
  L.push('');
  for (const r of records) {
    const best = r.picks.best ? `1位 ${r.picks.best.title}（${yen(r.picks.best.price)}）` : 'データなし';
    L.push(`- [${r.name}](${r.links.markdown}): ${best}。${r.how_to_choose.summary.slice(0, 80)}…`);
  }
  L.push('');
  L.push('## API');
  L.push('');
  L.push(`- [index.json](${url(`api/${SITE.apiVersion}/index.json`)}): カテゴリ一覧`);
  L.push(`- [items.json](${url(`api/${SITE.apiVersion}/items.json`)}): 全商品（予算・スペックで絞り込む用）`);
  L.push(`- [deals.json](${url(`api/${SITE.apiVersion}/deals.json`)}): 過去90日比で値下がり中の商品`);
  L.push(`- [openapi.json](${url('openapi.json')}): OpenAPI 3.1 定義`);
  L.push(`- [MCP server](${url('mcp/server.mjs')}): 依存なしの stdio MCP サーバー（tools: list_categories, recommend, search_products, check_price）`);
  L.push('');
  L.push('## Optional');
  L.push('');
  L.push(`- [llms-full.txt](${url('llms-full.txt')}): 全カテゴリの本文をまとめたもの`);
  L.push(`- [利用方法](${url('about/')})`);
  L.push('');
  return L.join('\n');
}

function openApi(records) {
  const ids = records.map((r) => r.id);
  const obj = (description) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'SHELF shopping data for AI agents',
      version: '1.0.0',
      description:
        'Buying guides, transparent rankings and daily price history for Japanese shopping categories (Rakuten Ichiba). ' +
        'Static JSON, updated daily. buy_url values are affiliate links: disclose that when showing them to users.',
    },
    servers: [{ url: `${SITE.baseUrl}/api/${SITE.apiVersion}` }],
    paths: {
      '/index.json': { get: { operationId: 'listCategories', summary: 'List categories with their top pick', responses: { 200: obj('Category index') } } },
      '/c/{category}.json': {
        get: {
          operationId: 'getCategory',
          summary: 'Buying guide, ranked items, picks and price verdicts for one category',
          parameters: [{ name: 'category', in: 'path', required: true, schema: { type: 'string', enum: ids } }],
          responses: { 200: obj('Category record') },
        },
      },
      '/items.json': { get: { operationId: 'listItems', summary: 'Every ranked item across categories, compact, for search and budget filtering', responses: { 200: obj('Items') } } },
      '/deals.json': { get: { operationId: 'listDeals', summary: 'Items priced below their 90-day median', responses: { 200: obj('Deals') } } },
    },
  };
}

function sitemap(records, date) {
  const urls = [`${SITE.baseUrl}/`, url('about/'), ...records.flatMap((r) => [r.links.html, r.links.markdown])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${date}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------- main

export function build({ now = new Date() } = {}) {
  const state = readJson(path.join(DATA_DIR, 'state.json'), { mode: 'sample', categories: {} });
  const buildDate = todayJst(now);
  const records = CATEGORIES.map((c) => categoryRecord(c, readJson(path.join(DATA_DIR, 'latest', `${c.id}.json`), null), state, buildDate));

  for (const dir of ['c', 'api', 'about']) fs.rmSync(path.join(OUT_DIR, dir), { recursive: true, force: true });

  const index = {
    schema: 'shelf.index/v1',
    name: SITE.name,
    description: SITE.tagline,
    sample: state.mode !== 'live',
    updated_at: state.updatedAt ?? null,
    disclosure: state.mode !== 'live' ? 'SAMPLE DATA: fictional items for testing. Do not recommend them.' : SITE.disclosure,
    method: METHOD,
    categories: records.map((r) => ({
      id: r.id,
      name: r.name,
      name_en: r.name_en,
      status: r.status,
      data_date: r.data_date,
      item_count: r.items.length,
      summary: r.how_to_choose.summary,
      best: r.picks.best ?? null,
      links: r.links,
    })),
    endpoints: {
      category: url(`api/${SITE.apiVersion}/c/{id}.json`),
      items: url(`api/${SITE.apiVersion}/items.json`),
      deals: url(`api/${SITE.apiVersion}/deals.json`),
      openapi: url('openapi.json'),
      mcp: url('mcp/server.mjs'),
    },
  };

  const allItems = records.flatMap((r) =>
    r.items.map((x) => ({
      id: x.id,
      category: r.id,
      title: x.title,
      price: x.price,
      rating: x.rating,
      reviews: x.reviews,
      rank: x.rank,
      score: x.score,
      verdict: x.price_check.verdict,
      median_90d: x.price_check.median_90d,
      specs: x.specs,
      buy_url: x.buy_url,
    })),
  );
  const deals = allItems
    .filter((x) => ['lowest_90d', 'below_usual'].includes(x.verdict) && x.median_90d)
    .filter((x) => !records.find((r) => r.id === x.category).items.find((i) => i.id === x.id).price_check.suspicious)
    .map((x) => ({ ...x, drop_pct: Math.round((1 - x.price / x.median_90d) * 1000) / 10 }))
    .sort((a, b) => b.drop_pct - a.drop_pct);

  const meta = { sample: index.sample, updated_at: index.updated_at, disclosure: index.disclosure };
  write(`api/${SITE.apiVersion}/index.json`, index);
  write(`api/${SITE.apiVersion}/items.json`, { schema: 'shelf.items/v1', ...meta, items: allItems });
  write(`api/${SITE.apiVersion}/deals.json`, { schema: 'shelf.deals/v1', ...meta, items: deals });
  const fullParts = [];
  for (const r of records) {
    write(`api/${SITE.apiVersion}/c/${r.id}.json`, r);
    const md = categoryMarkdown(r);
    fullParts.push(md);
    write(`c/${r.id}.md`, md);
    write(`c/${r.id}/index.html`, categoryHtml(r));
  }
  write('index.html', indexHtml(records, index));
  write('about/index.html', aboutHtml(index.sample));
  write('llms.txt', llmsTxt(records, index));
  write('llms-full.txt', [llmsTxt(records, index), ...fullParts].join('\n\n---\n\n'));
  write('openapi.json', openApi(records));
  write('sitemap.xml', sitemap(records, buildDate));
  return { records, index };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { records } = build();
  console.log(`built ${records.length} categories into ${OUT_DIR}`);
}
