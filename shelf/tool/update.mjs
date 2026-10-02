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
import { yahooCredentialsFromEnv, searchYahoo } from './yahoo.mjs';
import { rankCategory, choosePicks } from './rank.mjs';
import { recordPrices, priceStats, weeklySeries } from './history.mjs';
import { sampleItems, sampleYahooItems, sampleHistory } from './sample.mjs';
import { todayJst, isoJst } from './site.mjs';
import { build } from './build.mjs';
import { AREAS, stayDates, fetchNight, nightSnapshot, recordNight, pruneHistory, sampleNight } from './hotels.mjs';
import { SERIES, fetchSeries, sampleSeries } from './books.mjs';

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
// One item per line keeps the daily git diff to the lines that changed.
const writeHistory = (file, history) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = Object.keys(history).sort().map((id) => `${JSON.stringify(id)}:${JSON.stringify(history[id])}`);
  fs.writeFileSync(file, `{\n${lines.join(',\n')}\n}\n`);
};

export function processCategory(category, rawItems, history, date) {
  const { items, stats } = rankCategory(rawItems, category);
  recordPrices(history, items, date);
  for (const item of items) {
    item.priceStats = priceStats(history[item.id], item.price, date, item.shippingIncluded);
    item.priceWeekly = weeklySeries(history[item.id], date);
  }
  return { items, stats, picks: choosePicks(items, category) };
}

export async function update({ only, now = new Date(), env = process.env, forceSample = false } = {}) {
  const creds = credentialsFromEnv(env);
  const yahoo = yahooCredentialsFromEnv(env);
  const live = Boolean(creds || yahoo);
  const mode = live ? 'live' : 'sample';
  const date = todayJst(now);
  const statePath = path.join(DATA_DIR, 'state.json');
  const prev = readJson(statePath, {});
  if (prev.mode === 'live' && !live && !forceSample) {
    // Running without keys on a live checkout would replace months of real
    // price history with sample data.
    throw new Error('data/ holds live data but no Rakuten keys are set; pass --force-sample to replace it, or set SHELF_DATA_DIR');
  }
  const sources = live ? [creds && 'rakuten', yahoo && 'yahoo'].filter(Boolean) : ['sample'];
  const state = { mode, sources, date, updatedAt: isoJst(now), categories: { ...(prev.mode === mode ? prev.categories : {}) } };

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
      let raw = [];
      let history;
      const sourceErrors = [];
      if (live) {
        // Each store is fetched independently; one failing must not lose the other.
        const want = category.sources || ['rakuten', 'yahoo'];
        if (creds && want.includes('rakuten')) {
          try {
            raw.push(...(await searchCategory(creds, category)));
          } catch (err) {
            sourceErrors.push(`rakuten: ${err.message}`);
          }
        }
        if (yahoo && want.includes('yahoo')) {
          try {
            raw.push(...(await searchYahoo(yahoo, category)));
          } catch (err) {
            sourceErrors.push(`yahoo: ${err.message}`);
          }
        }
        if (!raw.length && sourceErrors.length) throw new Error(sourceErrors.join('; '));
        history = readJson(historyPath, {});
      } else {
        raw = [...sampleItems(category), ...sampleYahooItems(category)];
        history = sampleHistory(raw, date);
      }
      const result = processCategory(category, raw, history, date);
      if (!result.items.length) throw new Error('no items survived filtering');
      writeHistory(historyPath, history);
      writeJson(latestPath, { categoryId: category.id, date, fetchedAt: isoJst(now), ...result });
      state.categories[category.id] = { status: 'ok', fetchedAt: isoJst(now), stats: result.stats, ...(sourceErrors.length ? { sourceErrors } : {}) };
      console.log(`${category.id}: ${result.stats.ranked}/${result.stats.candidates} ranked`);
    } catch (err) {
      const before = state.categories[category.id] || {};
      state.categories[category.id] = { ...before, status: 'error', error: String(err.message || err).slice(0, 300), failedAt: isoJst(now) };
      console.error(`${category.id}: ${err.message}`);
    }
  }
  if (!only || only === 'hotels') state.hotels = await updateHotels({ creds, live, date, now });
  if (!only || only === 'books') state.books = await updateBooks({ creds, live, date, now });
  writeJson(statePath, state);
  return state;
}

// Hotels: one vacancy search per area and coming weekend night.
async function updateHotels({ creds, live, date, now }) {
  const latestPath = path.join(DATA_DIR, 'hotels', 'latest.json');
  const historyPath = path.join(DATA_DIR, 'hotels', 'history.json');
  if (live && !creds) return { status: 'skipped', reason: 'needs Rakuten keys' };
  const history = live ? readJson(historyPath, {}) : {};
  const nights = stayDates(date);
  const areas = {};
  const errors = [];
  for (const [ai, area] of AREAS.entries()) {
    areas[area.id] = {};
    for (const night of nights) {
      try {
        if (live) {
          const snap = nightSnapshot(await fetchNight(creds, area, night));
          recordNight(history, area.id, night, date, snap);
          areas[area.id][night] = snap;
        } else {
          // Three fictional observations per night, drifting up, down or flat by area.
          const drift = [0, 3, -3][ai % 3];
          for (let k = 0; k < 3; k++) {
            const day = new Date(Date.parse(`${date}T00:00:00Z`) - (2 - k) * 86400000).toISOString().slice(0, 10);
            recordNight(history, area.id, night, day, nightSnapshot(sampleNight(area, night, k * drift)));
          }
          areas[area.id][night] = nightSnapshot(sampleNight(area, night, 2 * drift));
        }
      } catch (err) {
        errors.push(`${area.id} ${night}: ${err.message}`.slice(0, 200));
      }
    }
  }
  pruneHistory(history, date);
  writeJson(historyPath, history);
  writeJson(latestPath, { date, fetchedAt: isoJst(now), nights, areas });
  console.log(`hotels: ${AREAS.length} areas × ${nights.length} nights${errors.length ? `, ${errors.length} errors` : ''}`);
  return { status: errors.length ? 'partial' : 'ok', errors: errors.slice(0, 5) };
}

// Books: newest volumes of each followed series.
async function updateBooks({ creds, live, date, now }) {
  const latestPath = path.join(DATA_DIR, 'books', 'latest.json');
  if (live && !creds) return { status: 'skipped', reason: 'needs Rakuten keys' };
  const prev = readJson(latestPath, { series: {} });
  const series = {};
  const errors = [];
  for (const s of SERIES) {
    try {
      series[s.id] = live ? await fetchSeries(creds, s) : sampleSeries(s, date);
    } catch (err) {
      series[s.id] = prev.series?.[s.id] ?? [];
      errors.push(`${s.id}: ${err.message}`.slice(0, 200));
    }
  }
  writeJson(latestPath, { date, fetchedAt: isoJst(now), series });
  console.log(`books: ${SERIES.length} series${errors.length ? `, ${errors.length} errors` : ''}`);
  return { status: errors.length ? 'partial' : 'ok', errors: errors.slice(0, 5) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const state = await update({ only, forceSample: process.argv.includes('--force-sample') });
  build();
  const failed = Object.entries(state.categories).filter(([, c]) => c.status === 'error');
  if (failed.length === CATEGORIES.length) {
    console.error('every category failed');
    process.exit(1);
  }
}
