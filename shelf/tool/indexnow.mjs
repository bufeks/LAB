#!/usr/bin/env node
// Tells search engines that power AI answers (Bing — used by ChatGPT search —
// and the other IndexNow members) which pages changed, right after a deploy,
// instead of waiting for them to recrawl.
//
//   INDEXNOW_KEY=<8-128 hex chars> SHELF_BASE_URL=https://shelf.example.com node shelf/tool/indexnow.mjs [edge-dist]
//
// The key file must be served at <base>/<key>.txt; edge.mjs writes it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function urlsFromSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

export function payload(base, key, urls) {
  const host = new URL(base).host;
  return { host, key, keyLocation: `${base.replace(/\/$/, '')}/${key}.txt`, urlList: urls.filter((u) => new URL(u).host === host).slice(0, 10000) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.env.INDEXNOW_KEY;
  const base = process.env.SHELF_BASE_URL;
  if (!key || !base) {
    console.log('INDEXNOW_KEY / SHELF_BASE_URL not set; skipping IndexNow.');
    process.exit(0);
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error('INDEXNOW_KEY must be 8-128 letters, digits or dashes');
  const dir = process.argv[2] || 'edge-dist';
  const body = payload(base, key, urlsFromSitemap(fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8')));
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  console.log(`IndexNow: ${res.status} for ${body.urlList.length} URLs`);
  if (res.status >= 400 && res.status !== 429) process.exit(1);
}
