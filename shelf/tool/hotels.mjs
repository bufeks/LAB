// Hotel prices: is this weekend getting more expensive?
//
// For each area and each coming Friday/Saturday night, Rakuten Travel's
// vacancy search returns the cheapest available hotels (2 adults, 1 room).
// The median of those prices is the area's level for that night; it is
// recorded every day, so a rising or falling trend for a given night shows
// up as the date approaches.

import { rakutenGet } from './rakuten.mjs';

const ENDPOINT = 'https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426';
const MIN_OBSERVATIONS = 3;
const TREND = 0.05;

// Areas by station coordinates and radius (WGS84), so no area codes are
// needed. Names are given in every published language.
export const AREAS = [
  { id: 'tokyo-shinjuku', lat: 35.6896, lng: 139.7006, radius: 1.0, names: { ja: '東京・新宿駅周辺', en: 'Tokyo: around Shinjuku Station', 'zh-Hans': '东京·新宿站周边', 'zh-Hant': '東京·新宿站周邊', ko: '도쿄·신주쿠역 주변' } },
  { id: 'tokyo-station', lat: 35.6812, lng: 139.7671, radius: 1.0, names: { ja: '東京駅周辺', en: 'Tokyo: around Tokyo Station', 'zh-Hans': '东京站周边', 'zh-Hant': '東京車站周邊', ko: '도쿄역 주변' } },
  { id: 'kyoto-station', lat: 34.9858, lng: 135.7588, radius: 1.0, names: { ja: '京都駅周辺', en: 'Kyoto: around Kyoto Station', 'zh-Hans': '京都站周边', 'zh-Hant': '京都車站周邊', ko: '교토역 주변' } },
  { id: 'osaka-namba', lat: 34.6661, lng: 135.5003, radius: 1.0, names: { ja: '大阪・なんば周辺', en: 'Osaka: around Namba', 'zh-Hans': '大阪·难波周边', 'zh-Hant': '大阪·難波周邊', ko: '오사카·난바 주변' } },
  { id: 'sapporo-station', lat: 43.0687, lng: 141.3508, radius: 1.0, names: { ja: '札幌駅周辺', en: 'Sapporo: around Sapporo Station', 'zh-Hans': '札幌站周边', 'zh-Hant': '札幌車站周邊', ko: '삿포로역 주변' } },
  { id: 'fukuoka-hakata', lat: 33.5902, lng: 130.4207, radius: 1.0, names: { ja: '福岡・博多駅周辺', en: 'Fukuoka: around Hakata Station', 'zh-Hans': '福冈·博多站周边', 'zh-Hant': '福岡·博多車站周邊', ko: '후쿠오카·하카타역 주변' } },
  { id: 'naha', lat: 26.2124, lng: 127.6792, radius: 1.0, names: { ja: '那覇・国際通り周辺', en: 'Naha: around Kokusai-dori', 'zh-Hans': '那霸·国际通周边', 'zh-Hant': '那霸·國際通周邊', ko: '나하·국제거리 주변' } },
];

const dayMs = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Coming Friday and Saturday nights, starting tomorrow, within `days`.
export function stayDates(today, days = 28) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const out = [];
  for (let d = 1; d <= days; d++) {
    const t = start + d * dayMs;
    const wd = new Date(t).getUTCDay();
    if (wd === 5 || wd === 6) out.push(iso(t));
  }
  return out;
}

export function buildHotelUrl(creds, area, date) {
  const u = new URL(creds.travelEndpoint || ENDPOINT);
  const p = u.searchParams;
  p.set('applicationId', creds.applicationId);
  p.set('accessKey', creds.accessKey);
  if (creds.affiliateId) p.set('affiliateId', creds.affiliateId);
  p.set('format', 'json');
  p.set('latitude', String(area.lat));
  p.set('longitude', String(area.lng));
  p.set('datumType', '1');
  p.set('searchRadius', String(area.radius));
  p.set('checkinDate', date);
  p.set('checkoutDate', iso(Date.parse(`${date}T00:00:00Z`) + dayMs));
  p.set('adultNum', '2');
  p.set('roomNum', '1');
  p.set('sort', '+roomCharge');
  p.set('hits', '30');
  return u;
}

// The response nests each hotel as a list of single-key objects
// ([{hotelBasicInfo}, {roomInfo: [...]}]), possibly wrapped in {hotel: ...}.
export function parseHotels(data) {
  const out = [];
  for (const entry of data.hotels || []) {
    const parts = Array.isArray(entry) ? entry : entry.hotel || [];
    const basic = parts.find((p) => p.hotelBasicInfo)?.hotelBasicInfo;
    if (!basic) continue;
    const charges = parts
      .flatMap((p) => p.roomInfo || [])
      .map((r) => r.dailyCharge?.total ?? r.dailyCharge?.rakutenCharge)
      .filter((n) => Number.isFinite(n) && n > 0);
    const price = charges.length ? Math.min(...charges) : Number(basic.hotelMinCharge) || null;
    if (!price) continue;
    out.push({
      id: `rt:${basic.hotelNo}`,
      name: basic.hotelName,
      url: basic.hotelInformationUrl,
      price,
      rating: Number(basic.reviewAverage) || null,
      reviews: Number(basic.reviewCount) || 0,
      station: basic.nearestStation || null,
      image: basic.hotelThumbnailUrl || null,
    });
  }
  return { hotels: out, available: Number(data.pagingInfo?.recordCount) || out.length };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function nightSnapshot(parsed) {
  const prices = parsed.hotels.map((h) => h.price);
  return {
    level: prices.length ? Math.round(median(prices)) : null,
    min: prices.length ? Math.min(...prices) : null,
    available: parsed.available,
    cheapest: [...parsed.hotels].sort((a, b) => a.price - b.price).slice(0, 3),
  };
}

// history: { "<area>|<night>": [[observedDate, level, available], ...] }
export function recordNight(history, areaId, night, date, snap) {
  if (snap.level == null) return;
  const key = `${areaId}|${night}`;
  const rows = (history[key] ||= []);
  const last = rows[rows.length - 1];
  if (last && last[0] === date) rows[rows.length - 1] = [date, snap.level, snap.available];
  else rows.push([date, snap.level, snap.available]);
}

export function pruneHistory(history, today) {
  for (const key of Object.keys(history)) if (key.split('|')[1] < today) delete history[key];
}

export function nightTrend(rows) {
  if (!rows || rows.length < MIN_OBSERVATIONS) return { verdict: 'insufficient', observations: rows?.length ?? 0 };
  const earlier = rows.slice(0, -1).map((r) => r[1]);
  const base = median(earlier);
  const now = rows[rows.length - 1][1];
  const change = now / base - 1;
  const verdict = change >= TREND ? 'rising' : change <= -TREND ? 'falling' : 'stable';
  return { verdict, observations: rows.length, change_pct: Math.round(change * 1000) / 10, baseline: Math.round(base) };
}

export async function fetchNight(creds, area, night) {
  return parseHotels(await rakutenGet(creds, buildHotelUrl(creds, area, night)));
}

// Fictional hotels for sample builds, with a few days of fake history so
// every trend path renders.
export function sampleNight(area, night, salt = 0) {
  const base = 9000 + ((area.lat * 1000 + Date.parse(night) / dayMs) % 7) * 1500;
  const hotels = Array.from({ length: 8 }, (_, i) => ({
    id: `sample-hotel:${area.id}-${i + 1}`,
    name: `(サンプル) ホテル ${String.fromCharCode(65 + i)}`,
    url: 'https://travel.rakuten.co.jp/',
    price: Math.round((base * (1 + i * 0.12) * (1 + salt * 0.03)) / 100) * 100,
    rating: Math.round((3.6 + ((i * 7) % 13) / 10) * 100) / 100,
    reviews: 50 + i * 40,
    station: null,
    image: null,
  }));
  return { hotels, available: 20 - salt * 2 };
}
