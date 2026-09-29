#!/usr/bin/env node
// Daily job: fetch every category, rank it, extend the price history, then
// rebuild the site. Without Rakuten credentials it runs on sample data.
//
//   node shelf/tool/update.mjs            # fetch (or sample) + build
//   node shelf/tool/update.mjs --only=humidifier

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './categories.mjs';
import { credentialsFromEnv, searchCategory } from './rakuten.mjs';
import { rankCategory, choosePicks } from './rank.mjs';
import { recordPrices, priceStats } from './history.mjs';
import { sampleItems, sampleHistory } from './sample.mjs';
import { todayJst } from './site.mjs';
import { build } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.SHELF_DATA_DIR || path.join(HERE, '..', 'data');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
};

export function processCategory(category, rawItems, history, date) {
  const { items, stats } = rankCategory(rawItems, category);
  recordPrices(history, items, date);
  for (const item of items) item.priceStats = priceStats(history[item.id], item.price, date);
  return { items, stats, picks: choosePicks(items) };
}

export async function update({ only, now = new Date(), env = process.env } = {}) {
  const creds = credentialsFromEnv(env);
  const mode = creds ? 'live' : 'sample';
  const date = todayJst(now);
  const statePath = path.join(DATA_DIR, 'state.json');
  const prev = readJson(statePath, {});
  const state = { mode, date, updatedAt: now.toISOString(), categories: { ...(prev.mode === mode ? prev.categories : {}) } };

  // Switching from sample to live must not carry fictional prices forward.
  if (prev.mode && prev.mode !== mode) {
    fs.rmSync(path.join(DATA_DIR, 'history'), { recursive: true, force: true });
    fs.rmSync(path.join(DATA_DIR, 'latest'), { recursive: true, force: true });
  }

  for (const category of CATEGORIES) {
    if (only && category.id !== only) continue;
    const historyPath = path.join(DATA_DIR, 'history', `${category.id}.json`);
    const latestPath = path.join(DATA_DIR, 'latest', `${category.id}.json`);
    try {
      let raw;
      let history;
      if (creds) {
        raw = await searchCategory(creds, category);
        history = readJson(historyPath, {});
      } else {
        raw = sampleItems(category);
        history = sampleHistory(raw, date);
      }
      const result = processCategory(category, raw, history, date);
      if (!result.items.length) throw new Error('no items survived filtering');
      writeJson(historyPath, history);
      writeJson(latestPath, { categoryId: category.id, date, fetchedAt: now.toISOString(), ...result });
      state.categories[category.id] = { status: 'ok', fetchedAt: now.toISOString(), stats: result.stats };
      console.log(`${category.id}: ${result.stats.ranked}/${result.stats.candidates} ranked`);
    } catch (err) {
      const before = state.categories[category.id] || {};
      state.categories[category.id] = { ...before, status: 'error', error: String(err.message || err).slice(0, 300), failedAt: now.toISOString() };
      console.error(`${category.id}: ${err.message}`);
    }
  }
  writeJson(statePath, state);
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const state = await update({ only });
  build();
  const failed = Object.entries(state.categories).filter(([, c]) => c.status === 'error');
  if (failed.length === CATEGORIES.length) {
    console.error('every category failed');
    process.exit(1);
  }
}
