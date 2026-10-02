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
  'hair-dryer': ['【20%OFF】大風量 2.0m3/分 1200W 温冷', '最大30%OFFクーポン 1.3m3/分 折りたたみ イオン', '1.6m3/分 スカルプモード 1200W', '軽量 1.4m3/分', 'ナノイー 1.6m3/分 温度切替', '2.2m3/分 低温 1200W'],
  'rice-cooker': ['半額 5.5合 圧力IH 予約', '3合 マイコン', '5.5合 IH 予約', '1升 圧力IH', '3合 IH', '5.5合 マイコン 予約'],
  'air-purifier': ['スーパーSALE 15%OFF 25畳 HEPA', '加湿 18畳 プラズマクラスター', '31畳 HEPA ストリーマ', '8畳 HEPA', '加湿 23畳 ナノイー', '40畳 HEPA'],
  'robot-vacuum': ['LiDAR マッピング 4000Pa', '水拭き 2700Pa', 'LiDAR 自動ゴミ収集 6000Pa', '2000Pa', 'マッピング 水拭き 自動ゴミ収集 8000Pa', 'LiDAR 5000Pa'],
  rice: ['コシヒカリ 令和7年産 10kg (5kg×2袋)', 'ブレンド米 5kg', 'あきたこまち 令和7年産 5kg 無洗米', 'ななつぼし 10kg', 'コシヒカリ 令和6年産 5kg×4袋 20kg', 'ゆめぴりか 5kg'],
  'mineral-water': ['天然水 2L×9本 硬度30', '天然水 500ml×24本 硬度60', 'ラベルレス 2L×6本×2ケース', '硬度300 2L×6本', '天然水 2L 9本', '500ml×48本 硬度20'],
  'toilet-paper': ['12ロール 50m ダブル', '2倍巻き 6ロール 100m シングル', '18ロール 27.5m ダブル', '3倍巻き 8ロール 150m シングル', '12ロール 60m シングル', '4ロール×12パック 30m ダブル'],
  'aa-batteries': ['単3形 40本 10年保存', '単3 20本 液漏れ防止', '単3形 アルカリ 8本', '単3形 20本×2パック', '単3 100本', '単3形 4本 10年保存'],
  'coffee-beans': ['深煎り 500g×2袋 豆のまま', '中煎り 200g 粉', '浅煎り 1kg 豆のまま', 'ブレンド 中深煎り 500g 豆', '深煎り 2kg 豆', '中煎り 300g×3袋 粉'],
  protein: ['ホエイ 1kg', 'WPI 3kg', 'ソイ 1kg', 'ホエイ 1kg×2袋', 'ホエイ 人工甘味料不使用 1kg', 'ソイ 900g'],
  'sonicare-heads': ['ソニッケアー 純正 4本', 'ソニッケアー 純正 2本', 'フィリップス ソニッケアー 正規品 8本', 'ソニッケアー 純正 ホワイトニング 3本', 'ソニッケアー 純正 6本', 'ソニッケアー 純正 1本'],
  'oralb-heads': ['ブラウン オーラルB 純正 4本', 'オーラルB 純正 やわらかめ 2本', 'ブラウン 純正 8本', 'オーラルB 純正 ホワイトニング 3本', 'ブラウン オーラルB 純正 6本', 'オーラルB 純正 1本'],
  'furusato-rice': ['コシヒカリ 15kg 令和7年産', 'ななつぼし 10kg (5kg×2袋)', 'あきたこまち 20kg', '無洗米 10kg', 'ひとめぼれ 5kg×3袋 15kg', 'ブランド米 つや姫 5kg'],
  'furusato-toilet-paper': ['96ロール 30m ダブル', '48ロール 60m シングル', '2倍巻き 48ロール 100m シングル', '64ロール 27.5m ダブル', '72ロール 55m シングル', '3倍巻き 24ロール 150m シングル'],
  'furusato-beef': ['黒毛和牛 切り落とし 1.2kg (600g×2)', '国産牛 こま切れ 2kg', '和牛 切り落とし 800g', '国産牛 切り落とし 500g×4', '黒毛和牛 こま切れ 1kg', '国産牛 切り落とし 3kg'],
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
      source: 'rakuten',
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
      points.push([day, Math.round((item.price * drift * (0.97 + rand() * 0.06)) / 10) * 10, item.shippingIncluded ? 1 : 0]);
    }
    history[item.id] = { name: item.name, points };
  });
  return history;
}

// The same sample products as listed by another store, so cross-store
// merging and the "cheapest offer" path run without real data.
export function sampleYahooItems(category) {
  if (category.sources && !category.sources.includes('yahoo')) return [];
  return sampleItems(category)
    .filter((_, i) => i % 3 === 0)
    .map((x, i) => ({
      ...x,
      id: `sample-y:${category.id}-${i + 1}`,
      source: 'yahoo',
      shop: 'サンプルストア',
      price: Math.round((x.price * (i % 2 ? 1.04 : 0.93)) / 10) * 10,
      reviews: Math.round(x.reviews / 3),
      shippingIncluded: true,
    }));
}
