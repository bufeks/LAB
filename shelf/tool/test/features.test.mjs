// Sale check, compatibility, hotels, books and feeds: the pure logic, the
// built output in every language, and the MCP tools and Worker routes on top.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saleCheck, activeEvents } from '../sale.mjs';
import { checkCompatibility } from '../compat.mjs';
import { parseHotels, nightTrend, stayDates, recordNight, pruneHistory } from '../hotels.mjs';
import { parseSalesDate, filterSeries, icsCalendar } from '../books.mjs';
import { atomFeed } from '../feeds.mjs';
import { claimedDiscount } from '../rank.mjs';

const stats = (median, points = 20) => ({ median90: median, points, verdict: 'usual' });

test('sale check compares claims with the item’s own history', () => {
  const at = (price, claim, ps = stats(10000)) => saleCheck({ price, claimed: claimedDiscount(claim), priceStats: ps })?.verdict;
  assert.equal(at(8000, '【20%OFF】'), 'genuine');
  assert.equal(at(9600, '半額'), 'smaller_than_claimed');
  assert.equal(at(9900, '50%OFF'), 'not_lower_than_usual');
  assert.equal(at(8000, '最大30%OFFクーポン'), 'coupon');
  assert.equal(at(8000, '20%OFF', { verdict: 'insufficient_data', points: 3 }), 'unverified');
  assert.equal(saleCheck({ price: 100, claimed: null }), null);
  // "Up to 50%" is judged more leniently than a flat "50%".
  assert.equal(at(8500, '最大50%OFF'), 'genuine');
  // Coupons are not price cuts, but do not hide a real price-cut claim.
  assert.equal(at(5000, '半額クーポン'), 'coupon');
  assert.equal(at(7000, '30%OFF 10%OFFクーポン'), 'genuine');
  // Variant listings and suspicious prices cannot back a claim.
  assert.equal(saleCheck({ price: 8000, variants: true, claimed: claimedDiscount('20%OFF'), priceStats: stats(10000) }).verdict, 'unverified');
  assert.equal(saleCheck({ price: 3000, claimed: claimedDiscount('70%OFF'), priceStats: { ...stats(10000), suspicious: true } }).verdict, 'unverified');
});

test('events: point days by rule, big sales by how many titles mention them', () => {
  assert.deepEqual(activeEvents('2026-10-15', []).map((e) => e.id), ['rakuten-5-0', 'yahoo-5']);
  assert.deepEqual(activeEvents('2026-10-20', []).map((e) => e.id), ['rakuten-5-0']);
  const names = [...Array(9).fill('ケトル'), '【スーパーSALE】ケトル'];
  assert.ok(activeEvents('2026-10-03', names).some((e) => e.id === 'rakuten-super-sale'));
  assert.ok(!activeEvents('2026-10-03', [...Array(30).fill('ケトル'), 'スーパーSALE']).some((e) => e.id === 'rakuten-super-sale'));
});

test('compatibility follows manufacturer rules, exceptions first, never guesses', () => {
  assert.equal(checkCompatibility('HX6859/43').rule, 'sonicare-click-on');
  assert.equal(checkCompatibility('ソニッケアー エッセンス').rule, 'sonicare-essence-legacy');
  assert.equal(checkCompatibility('HY1100').rule, 'philips-one');
  assert.equal(checkCompatibility('iO9').rule, 'oralb-io');
  assert.equal(checkCompatibility('D305').rule, 'oralb-round');
  assert.equal(checkCompatibility('Panasonic EW-DE55').verdict, 'unknown');
  // Regressions: "ソニック" inside パナソニック, "io" inside other words, and a
  // model number beating a name rule.
  assert.equal(checkCompatibility('パナソニック ドルツ EW-DT72').verdict, 'unknown');
  assert.equal(checkCompatibility('ionic').verdict, 'unknown');
  assert.equal(checkCompatibility('iOS').verdict, 'unknown');
  assert.equal(checkCompatibility('iOM9').rule, 'oralb-io');
  assert.equal(checkCompatibility('エッセンス+ HX3274').rule, 'sonicare-click-on');
});

test('hotels: response parsing in both shapes, weekend nights, trends', () => {
  const hotel = (no, total) => [{ hotelBasicInfo: { hotelNo: no, hotelName: `H${no}`, hotelInformationUrl: 'https://x', reviewAverage: 4.1, reviewCount: 9 } }, { roomInfo: [{ roomBasicInfo: {} }, { dailyCharge: { total } }] }];
  const v1 = parseHotels({ pagingInfo: { recordCount: 42 }, hotels: [{ hotel: hotel(1, 12000) }, { hotel: hotel(2, 9000) }] });
  const v2 = parseHotels({ hotels: [hotel(1, 12000), hotel(2, 9000)] });
  assert.deepEqual(v1.hotels.map((h) => h.price), [12000, 9000]);
  assert.equal(v1.available, 42);
  assert.deepEqual(v2.hotels.map((h) => h.id), ['rt:1', 'rt:2']);
  // Per-person charges are never mixed in with whole-room totals.
  const perPerson = [{ hotelBasicInfo: { hotelNo: 3, hotelName: 'H3', hotelMinCharge: 4000 } }, { roomInfo: [{ dailyCharge: { rakutenCharge: 4000 } }] }];
  assert.deepEqual(parseHotels({ hotels: [hotel(1, 12000), perPerson] }).hotels.map((h) => h.id), ['rt:1']);
  assert.deepEqual(stayDates('2026-10-02', 9), ['2026-10-03', '2026-10-09', '2026-10-10']);
  assert.equal(nightTrend([['a', 10000, 9], ['b', 10000, 8]]).verdict, 'insufficient');
  assert.equal(nightTrend([['a', 10000], ['b', 10000], ['c', 11000]]).verdict, 'rising');
  assert.equal(nightTrend([['a', 10000], ['b', 10000], ['c', 9000]]).verdict, 'falling');
  assert.equal(nightTrend([['a', 10000], ['b', 10000], ['c', 10200]]).verdict, 'stable');
  const h = {};
  recordNight(h, 'kyoto', '2026-10-03', '2026-10-01', { level: 9000, available: 5 });
  recordNight(h, 'kyoto', '2026-10-03', '2026-10-01', { level: 9500, available: 4 });
  assert.deepEqual(h['kyoto|2026-10-03'], [['2026-10-01', 9500, 4]]);
  pruneHistory(h, '2026-10-04');
  assert.deepEqual(h, {});
});

test('books: release dates, series filtering, iCalendar', () => {
  assert.deepEqual(parseSalesDate('2026年10月04日頃'), { date: '2026-10-04', until: '2026-10-04', approx: true, precision: 'day' });
  // A period stays upcoming until it ends.
  assert.deepEqual(parseSalesDate('2026年11月下旬'), { date: '2026-11-21', until: '2026-11-30', approx: true, precision: 'late-month' });
  assert.deepEqual(parseSalesDate('2027年2月'), { date: '2027-02-01', until: '2027-02-28', approx: true, precision: 'month' });
  assert.equal(parseSalesDate('2027年'), null);
  const kept = filterSeries(
    [{ isbn: '1', title: 'ONE PIECE 112' }, { isbn: '2', title: 'ONE PIECE magazine ガイド' }, { isbn: '1', title: 'ONE PIECE 112' }, { isbn: '3', title: '別の漫画' }],
    { match: 'ONE PIECE', exclude: 'ガイド' },
  );
  assert.deepEqual(kept.map((b) => b.isbn), ['1']);
  const ics = icsCalendar([{ isbn: '978', title: 'ONE PIECE 112, 特装版', sales_date: '2026-11-04', sales_date_text: '2026年11月04日', approx: false, publisher: '集英社' }], { name: 'SHELF', url: 'https://x/books/' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261104\r\nDTEND;VALUE=DATE:20261105/);
  assert.match(ics, /SUMMARY:ONE PIECE 112\\, 特装版/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  // Stable between builds of the same data; long lines fold without
  // splitting a character.
  const long = [{ isbn: '9', title: '😀'.repeat(40), sales_date: '2026-11-21', sales_until: '2026-11-30', sales_date_text: '2026年11月下旬', approx: true, publisher: 'x' }];
  const a = icsCalendar(long, { name: 'S', url: 'u', stamp: '2026-10-02' });
  assert.equal(a, icsCalendar(long, { name: 'S', url: 'u', stamp: '2026-10-02' }));
  assert.match(a, /DTEND;VALUE=DATE:20261201/);
  assert.ok(!a.includes('\uFFFD'));
  assert.equal(a.replace(/\r\n /g, '').match(/😀/g).length, 40);
});

test('atom feeds escape text and carry stable entry ids', () => {
  const xml = atomFeed({ id: 'u', title: 'A & B', selfUrl: 's', pageUrl: 'p', updated: '2026-10-02T00:00:00+09:00', lang: 'ja', entries: [{ id: 'e<1>', title: '<x>', link: 'l', updated: 'u', summary: '"q"' }] });
  assert.match(xml, /<title>A &amp; B<\/title>/);
  assert.match(xml, /<id>e&lt;1&gt;<\/id>/);
  assert.doesNotMatch(xml, /<x>/);
});

// ---------------------------------------------------------------- built site

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-features-'));
const env = { ...process.env, SHELF_DATA_DIR: path.join(tmp, 'data'), SHELF_OUT_DIR: path.join(tmp, 'out'), RAKUTEN_APP_ID: '', RAKUTEN_ACCESS_KEY: '', YAHOO_APP_ID: '' };
execFileSync(process.execPath, [path.join(TOOL, 'update.mjs')], { env, stdio: 'pipe' });
const OUT = path.join(tmp, 'out');
const read = (rel) => fs.readFileSync(path.join(OUT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

test('every language gets sale, compat, hotels, feeds; books and furusato stay Japanese', () => {
  for (const p of ['', 'en/', 'zh-hans/', 'zh-hant/', 'ko/']) {
    for (const rel of ['sale/index.html', 'compat/index.html', 'hotels/index.html', 'hotels.md', 'deals.xml', 'c/rice/feed.xml', 'c/rice/index.html']) assert.ok(fs.existsSync(path.join(OUT, p, rel)), p + rel);
    assert.ok(json(`api/v1/${p}hotels.json`).areas.length === 7);
  }
  assert.ok(fs.existsSync(path.join(OUT, 'books/index.html')) && fs.existsSync(path.join(OUT, 'books.ics')));
  assert.ok(!fs.existsSync(path.join(OUT, 'en/books')));
  assert.ok(fs.existsSync(path.join(OUT, 'c/furusato-rice/index.html')));
  assert.ok(!fs.existsSync(path.join(OUT, 'en/c/furusato-rice')));
  assert.ok(!json('api/v1/en/index.json').categories.some((c) => c.id.startsWith('furusato')));
});

test('unit prices, cross-store offers and sale checks reach the records', () => {
  const rice = json('api/v1/c/rice.json');
  assert.equal(rice.unit_rule.label, '1kgあたり');
  assert.ok(rice.unit_ranking.length > 0);
  const ranked = rice.unit_ranking.map((id) => rice.items.find((x) => x.id === id).unit_price.value);
  assert.deepEqual(ranked, [...ranked].sort((a, b) => a - b));
  assert.ok(rice.picks.per_unit);
  const furusato = json('api/v1/c/furusato-rice.json');
  assert.equal(furusato.unit_rule.higher_is_better, true);
  const fr = furusato.unit_ranking.map((id) => furusato.items.find((x) => x.id === id).unit_price.value);
  assert.deepEqual(fr, [...fr].sort((a, b) => b - a));
  const all = ['protein', 'rice', 'hair-dryer'].flatMap((id) => json(`api/v1/c/${id}.json`).items);
  assert.ok(all.some((x) => x.other_offers.some((o) => o.store === 'yahoo')));
  assert.ok(all.some((x) => x.cheapest_offer?.store === 'yahoo'));
  const sale = json('api/v1/sale.json');
  assert.ok(sale.items.length >= 3);
  assert.ok(sale.items.some((i) => i.verdict === 'coupon'));
  assert.match(read('index.html'), /Webサービス by Yahoo! JAPAN/);
  assert.match(read('en/c/rice.md'), /## Cheapest per kg/);
});

function mcp() {
  const child = spawn(process.execPath, [path.join(TOOL, '..', 'mcp', 'server.mjs')], { env: { ...process.env, SHELF_LOCAL_DIR: path.join(OUT, 'api/v1') } });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg.result);
    }
  });
  let n = 0;
  const tool = (name, args) =>
    new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    });
  return { tool, close: () => child.kill() };
}

test('MCP: compatibility, sale check, hotels, releases, unit-price sort', async () => {
  const s = mcp();
  try {
    const c = await s.tool('check_compatibility', { model: 'HX6859' });
    assert.equal(c.isError, false);
    assert.match(c.content[0].text, /philips\.co\.jp/);
    assert.match((await s.tool('check_compatibility', { model: 'ZZ999' })).content[0].text, /No rule matches/);
    const sale = await s.tool('sale_check', { verdict: 'coupon', lang: 'en' });
    assert.ok(sale.structuredContent.result.items.every((i) => i.verdict === 'coupon'));
    const h = await s.tool('hotel_outlook', { area: '京都' });
    assert.equal(h.structuredContent.result.areas[0].id, 'kyoto-station');
    assert.equal((await s.tool('hotel_outlook', { area: 'Atlantis' })).isError, true);
    const b = await s.tool('upcoming_releases', { series: 'ONE PIECE' });
    assert.ok(b.structuredContent.result.upcoming.length > 0);
    const r = await s.tool('recommend', { category: 'mineral-water', sort: 'unit_price', limit: 3, lang: 'en' });
    const v = r.structuredContent.result.items.map((x) => x.unit_price?.value ?? Infinity);
    assert.deepEqual(v, [...v].sort((a, b) => a - b));
    assert.equal((await s.tool('recommend', { category: 'kettle', sort: 'unit_price' })).isError, true);
  } finally {
    s.close();
  }
});

test('Worker watch feed: ids in the URL, nothing stored, links to SHELF pages', async () => {
  const { default: worker } = await import('../../worker/index.mjs');
  const fakeEnv = {
    ASSETS: {
      async fetch(req) {
        const file = path.join(OUT, decodeURIComponent(new URL(req.url).pathname));
        return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response('nf', { status: 404 });
      },
    },
  };
  const items = json('api/v1/en/items.json').items;
  const cheap = items.find((x) => ['lowest_observed', 'below_usual'].includes(x.verdict));
  const res = await worker.fetch(new Request(`https://shelf.example.com/feed/watch.xml?lang=en&ids=${encodeURIComponent(`${cheap.id},${items[0].id}`)}`), fakeEnv);
  const xml = await res.text();
  assert.equal(res.headers.get('Content-Type'), 'application/atom+xml; charset=utf-8');
  assert.match(xml, new RegExp(`/en/c/${cheap.category}/`));
  const below = await (await worker.fetch(new Request(`https://shelf.example.com/feed/watch.xml?ids=${encodeURIComponent(items[0].id)}&below=1`), fakeEnv)).text();
  assert.doesNotMatch(below, /<entry>/);
  assert.equal((await worker.fetch(new Request('https://shelf.example.com/feed/watch.xml'), fakeEnv)).status, 400);
});
