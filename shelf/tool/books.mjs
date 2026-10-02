// New-release calendar for book series (Japanese only: these are Japanese
// editions). Rakuten Books search, newest first; volumes whose release date
// is today or later are "upcoming". Published as a page, JSON, an Atom feed
// and an iCalendar file people can subscribe to.

import { rakutenGet } from './rakuten.mjs';

const ENDPOINT = 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404';

// Series to follow. `title` is the search term; `match` must appear in a
// result's title or seriesName for it to count (keeps spin-offs and guide
// books out unless they share the name — `exclude` removes those).
export const SERIES = [
  { id: 'one-piece', title: 'ONE PIECE', match: 'ONE PIECE', exclude: 'novel|ノベル|カラーウォーク|ガイド|総集編|学園|エピソード' },
  { id: 'kingdom', title: 'キングダム', match: 'キングダム', exclude: 'ガイド|公式|画集|ノベル' },
  { id: 'detective-conan', title: '名探偵コナン', match: '名探偵コナン', exclude: '小説|ガイド|特別編|ゼロの日常|犯人の犯沢|ジュニア|アニメ|ワイド' },
  { id: 'spy-family', title: 'SPY×FAMILY', match: 'SPY×FAMILY', exclude: 'ガイド|公式|ノベル|小説|画集' },
  { id: 'frieren', title: '葬送のフリーレン', match: '葬送のフリーレン', exclude: 'ガイド|公式|ノベル|小説|画集|アンソロジー' },
  { id: 'kusuriya', title: '薬屋のひとりごと', match: '薬屋のひとりごと', exclude: 'ガイド|公式|画集|アンソロジー|猫猫の後宮謎解き手帳' },
  { id: 'chainsaw-man', title: 'チェンソーマン', match: 'チェンソーマン', exclude: 'ガイド|公式|画集|ノベル|小説|バディ・ストーリーズ' },
  { id: 'blue-lock', title: 'ブルーロック', match: 'ブルーロック', exclude: 'ガイド|公式|画集|ノベル|小説|EPISODE' },
];

export const TEXT = {
  title: '新刊発売日カレンダー',
  lead: '人気シリーズの新刊の発売予定日を、楽天ブックスのデータから毎日自動で更新しています。カレンダーアプリやフィードリーダーで購読できます。',
  upcoming: '発売予定',
  recent: '最近発売された巻',
  none: 'この期間の発売予定は見つかりませんでした。',
  approx: '頃',
  subscribe: '購読',
  ics: 'カレンダーに追加（iCalendar）',
  atom: 'フィード（Atom）',
  method: '楽天ブックスで各シリーズ名を発売日の新しい順に検索し、シリーズ名を含み、ガイドブックや小説版などの関連本を除いたものを載せている。発売日は出版社の予定で、変わることがある。「頃」が付く日付は目安。',
  disclosure: 'PR: 本へのリンクは楽天ブックスのアフィリエイトリンクです。購入されると運営者に紹介料が入りますが、価格は変わりません。',
  series: 'シリーズ',
  volume: '本',
  date: '発売日',
  price: '価格',
  buy: '楽天ブックス',
  preorder: '予約受付中',
};

export function buildBooksUrl(creds, series) {
  const u = new URL(creds.booksEndpoint || ENDPOINT);
  const p = u.searchParams;
  p.set('applicationId', creds.applicationId);
  p.set('accessKey', creds.accessKey);
  if (creds.affiliateId) p.set('affiliateId', creds.affiliateId);
  p.set('format', 'json');
  p.set('formatVersion', '2');
  p.set('title', series.title);
  p.set('sort', '-releaseDate');
  p.set('outOfStockFlag', '1');
  p.set('hits', '30');
  return u;
}

// "2026年10月04日頃" -> { date: '2026-10-04', approx: true, precision: 'day' }
// "2026年10月" -> month precision (dated the 1st); "2026年" -> null.
export function parseSalesDate(s) {
  const t = String(s || '').normalize('NFKC');
  const d = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (d) return { date: `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`, approx: /頃|予定|以降/.test(t), precision: 'day' };
  const m = t.match(/(\d{4})年(\d{1,2})月/);
  if (m) return { date: `${m[1]}-${m[2].padStart(2, '0')}-01`, approx: true, precision: /上旬/.test(t) ? 'early-month' : /中旬/.test(t) ? 'mid-month' : /下旬/.test(t) ? 'late-month' : 'month' };
  return null;
}

export function normalizeBook(raw, series) {
  const sd = parseSalesDate(raw.salesDate);
  if (!sd) return null;
  return {
    id: `isbn:${raw.isbn}`,
    series: series.id,
    title: raw.title,
    author: raw.author,
    publisher: raw.publisherName,
    isbn: raw.isbn,
    sales_date: sd.date,
    sales_date_text: raw.salesDate,
    approx: sd.approx,
    precision: sd.precision,
    price: Number(raw.itemPrice) || null,
    buy_url: raw.affiliateUrl || raw.itemUrl,
    affiliate: Boolean(raw.affiliateUrl),
    image: raw.largeImageUrl || raw.mediumImageUrl || null,
    preorder: Number(raw.availability) === 5,
  };
}

export function filterSeries(items, series) {
  const match = new RegExp(series.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const exclude = series.exclude ? new RegExp(series.exclude, 'i') : null;
  const seen = new Set();
  return items.filter((b) => {
    if (!b || seen.has(b.isbn)) return false;
    seen.add(b.isbn);
    const t = `${b.title}`;
    return match.test(t) && !(exclude && exclude.test(t));
  });
}

export async function fetchSeries(creds, series) {
  const data = await rakutenGet(creds, buildBooksUrl(creds, series));
  const list = (data.Items || []).map((x) => normalizeBook(x.Item || x, series));
  return filterSeries(list, series);
}

export function sampleSeries(series, today) {
  const base = Date.parse(`${today}T00:00:00Z`);
  return [-20, 12, 45].map((offset, i) => {
    const date = new Date(base + offset * 86400000).toISOString().slice(0, 10);
    return {
      id: `sample-book:${series.id}-${i + 1}`,
      series: series.id,
      title: `(サンプル) ${series.title} ${100 + i}`,
      author: 'サンプル著者',
      publisher: 'サンプル出版',
      isbn: `sample-${series.id}-${i}`,
      sales_date: date,
      sales_date_text: `${date.slice(0, 4)}年${date.slice(5, 7)}月${date.slice(8, 10)}日頃`,
      approx: true,
      precision: 'day',
      price: 594,
      buy_url: 'https://books.rakuten.co.jp/',
      affiliate: false,
      image: null,
      preorder: offset > 0,
    };
  });
}

// iCalendar (RFC 5545) with one all-day event per upcoming volume.
export function icsCalendar(books, { name, url }) {
  const fold = (line) => {
    const out = [];
    let s = line;
    while (Buffer.byteLength(s) > 74) {
      let i = 74;
      while (Buffer.byteLength(s.slice(0, i)) > 74) i--;
      out.push(s.slice(0, i));
      s = ` ${s.slice(i)}`;
    }
    out.push(s);
    return out.join('\r\n');
  };
  const escText = (t) => String(t).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const day = (d) => d.replace(/-/g, '');
  const next = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SHELF//books//JA', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escText(name)}`];
  for (const b of books) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.isbn}@shelf-books`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
      `DTSTART;VALUE=DATE:${day(b.sales_date)}`,
      `DTEND;VALUE=DATE:${day(next(b.sales_date))}`,
      `SUMMARY:${escText(`${b.title}${b.approx ? '（予定）' : ''}`)}`,
      `DESCRIPTION:${escText(`${b.sales_date_text} / ${b.publisher ?? ''}`)}`,
      `URL:${url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
