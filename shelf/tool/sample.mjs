// Stand-in data for running SHELF without Rakuten credentials (local
// development, forks, CI). Every item is visibly fictional: names start with
// "(サンプル)", links go to a plain Rakuten search, and the whole build is
// flagged sample=true / noindex so it can never pass for real listings.

const SPECS = {
  'mobile-battery': [
    '10000mAh 22.5W PD PSE適合 薄型', '20000mAh 65W PD ノートPC対応 PSE', '5000mAh マグネット式 20W PSE',
    '10000mAh ケーブル内蔵 20W PSE', '27000mAh 140W PD PSE', '10000mAh 30W 軽量 PSE',
  ],
  'usb-c-charger': [
    '65W 3ポート GaN 折りたたみ PPS', '20W 1ポート 小型', '100W 4ポート GaN', '30W 2ポート GaN PPS',
    '45W 1ポート GaN PPS 折りたたみ', '140W 3ポート GaN',
  ],
  'wireless-earphones': [
    'ノイズキャンセリング マルチポイント IPX4 最大40時間', 'LDAC ノイズキャンセリング IPX5', '軽量 IPX4 最大30時間',
    'aptX マルチポイント IPX7', 'ノイズキャンセリング 最大50時間', 'マルチポイント LDAC IPX4',
  ],
  'electric-kettle': [
    '0.8L 1250W 転倒湯もれ防止', '1.0L 温度調節 保温 1200W', '0.6L 細口 ドリップ 温度調節',
    '1.2L 1300W 転倒湯もれ防止 二重構造', '1.0L 1250W', '0.8L 細口 ドリップ 900W',
  ],
  humidifier: [
    'スチーム式 木造8畳/プレハブ13畳 480mL/h タンク3.0L', '気化式 18畳 700mL/h タンク4.2L', '超音波式 6畳 300mL/h タンク2.5L',
    'ハイブリッド 14畳 600mL/h タンク4.0L', 'スチーム式 10畳 タンク2.2L', '超音波式 アロマ対応 8畳',
  ],
  'electric-toothbrush': [
    '音波 圧センサー 2分タイマー 3つのモード', '回転 押しつけ防止 タイマー', '音波 タイマー 軽量',
    '音波 5つのモード 過圧', '回転 2つのモード', '音波 タイマー 替えブラシ2本付き',
  ],
};

// Small deterministic PRNG so sample builds are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function sampleItems(category) {
  const rand = rng([...category.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const specs = SPECS[category.id] || ['標準モデル'];
  const lo = category.minPrice || 1000;
  const hi = Math.min(category.maxPrice || lo * 10, lo * 8);
  const searchUrl = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(category.query)}/`;
  return specs.map((spec, i) => {
    const price = Math.round((lo + rand() * (hi - lo)) / 10) * 10 - 20;
    return {
      id: `sample:${category.id}-${i + 1}`,
      source: 'sample',
      name: `(サンプル) ${category.name} ${String.fromCharCode(65 + i)} ${spec}`,
      caption: '',
      shop: 'サンプルショップ',
      price,
      shippingIncluded: i % 2 === 0,
      pointRate: 1,
      rating: Math.round((3.8 + rand() * 1.1) * 100) / 100,
      reviews: Math.round(40 + rand() * 4000),
      productUrl: searchUrl,
      buyUrl: searchUrl,
      affiliate: false,
      image: null,
      available: true,
    };
  });
}

// Fictional past prices, so the price-verdict path is exercised in samples.
export function sampleHistory(items, date, days = 30) {
  const history = {};
  const end = Date.parse(`${date}T00:00:00Z`);
  items.forEach((item, idx) => {
    const rand = rng(idx + 11);
    const points = [];
    for (let d = days; d >= 1; d--) {
      const day = new Date(end - d * 86400000).toISOString().slice(0, 10);
      const drift = idx % 3 === 0 ? 1.15 : idx % 3 === 1 ? 1.0 : 0.95;
      points.push([day, Math.round((item.price * drift * (0.97 + rand() * 0.06)) / 10) * 10]);
    }
    history[item.id] = { name: item.name, points };
  });
  return history;
}
