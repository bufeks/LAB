#!/usr/bin/env node
// Prepares the Cloudflare deployment: copies the public part of the build
// into edge-dist/ and writes wrangler.gen.json next to it (repo root).
//
//   SHELF_EDGE=1 SHELF_BASE_URL=https://example.com node shelf/tool/build.mjs
//   node shelf/tool/edge.mjs
//   npx wrangler deploy --config wrangler.gen.json
//
// Env: SHELF_BASE_URL (custom domain; a github.io/workers.dev URL adds no
// route), SHELF_WORKER_NAME (default "shelf").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, SOURCE } from './i18n/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELF = path.join(HERE, '..');
const ROOT = path.join(SHELF, '..');
const OUT = process.env.SHELF_OUT_DIR || SHELF;
const DIST = path.join(ROOT, 'edge-dist');

// Everything a visitor or agent may fetch; tool/, data/, worker/ stay private.
export const GENERATED = [
  'index.html', '404.html', 'robots.txt', 'llms.txt', 'llms-full.txt', 'openapi.json', 'sitemap.xml',
  'about', 'c', 'api', 'sale', 'compat', 'hotels', 'hotels.md', 'deals.xml', 'books', 'books.ics', 'books.xml',
  // Each language's pages (/en/, /zh-hans/, ...).
  ...LOCALES.filter((L) => L !== SOURCE).map((L) => L.slug),
];
// Hand-written files, always taken from the repository.
export const STATIC = ['assets', 'mcp/server.mjs'];

export function edgeConfig(env = process.env) {
  const base = env.SHELF_BASE_URL ? new URL(env.SHELF_BASE_URL) : null;
  const custom = base && !/(\.github\.io|\.workers\.dev)$/.test(base.hostname);
  if (custom && base.pathname.replace(/\/$/, '') !== '') {
    throw new Error('SHELF_BASE_URL must be a domain root (e.g. https://shelf.example.com) for the Cloudflare deployment');
  }
  return {
    name: env.SHELF_WORKER_NAME || 'shelf',
    main: 'shelf/worker/index.mjs',
    compatibility_date: '2026-06-01',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: true,
    assets: {
      directory: 'edge-dist',
      binding: 'ASSETS',
      run_worker_first: true,
      html_handling: 'auto-trailing-slash',
      not_found_handling: '404-page',
    },
    analytics_engine_datasets: [{ binding: 'EVENTS', dataset: 'shelf_events' }],
    observability: { enabled: true },
    ...(custom ? { routes: [{ pattern: base.hostname, custom_domain: true }] } : {}),
  };
}

// Copies the public files of an edge build in `out` into `dist`.
export function assemble(out = OUT, dist = DIST) {
  const index = JSON.parse(fs.readFileSync(path.join(out, 'api/v1/index.json'), 'utf8'));
  if (!index.endpoints.mcp_remote) throw new Error('build first with SHELF_EDGE=1');
  fs.rmSync(dist, { recursive: true, force: true });
  for (const [dir, rel] of [...GENERATED.map((r) => [out, r]), ...STATIC.map((r) => [SHELF, r])]) {
    const from = path.join(dir, rel);
    if (!fs.existsSync(from)) throw new Error(`missing ${rel}; run build.mjs first`);
    fs.cpSync(from, path.join(dist, rel), { recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assemble();
  const config = edgeConfig();
  fs.writeFileSync(path.join(ROOT, 'wrangler.gen.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(`edge-dist ready; ${config.routes ? `route ${config.routes[0].pattern}` : 'workers.dev only'}`);
}
