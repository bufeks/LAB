// Categories SHELF tracks. Each one is a Rakuten search plus the rules that
// turn its results into a comparable, honest shortlist:
//
//   query/ngKeywords/minPrice/maxPrice  -> what Rakuten is asked for
//   require/exclude                     -> title regexes: must look like the product itself,
//                                          not a case, spare part or refill
//   minReviews                          -> items with fewer reviews are not ranked
//   facets                              -> specs pulled out of titles so agents can filter
//   guide                               -> buying criteria written for this site; it is the
//                                          part an agent quotes when it explains a choice
//
// Facet patterns run against the item title (and caption when present), so
// they are hints, not guarantees; every output says so.

export const CATEGORIES = [
  {
    id: 'mobile-battery',
    name: 'モバイルバッテリー',
    nameEn: 'Power bank',
    query: 'モバイルバッテリー',
    ngKeywords: ['中古', 'ジャンク'],
    require: 'モバイル\\s*バッテリー',
    exclude: ['(ケース|ポーチ|カバー)のみ', '(ケース|ポーチ|カバー)\\s*(単品|単体)', 'セル交換', '部品'],
    minPrice: 1000,
    maxPrice: 20000,
    minReviews: 30,
    facets: [
      { key: 'capacity_mah', label: '容量', unit: 'mAh', type: 'number', pattern: '(\\d{1,3}[,，]?\\d{3})\\s*mAh', pick: 'max', min: 1000, max: 60000 },
      { key: 'output_w', label: '最大出力', unit: 'W', type: 'number', pattern: '(\\d{2,3}(?:\\.\\d)?)\\s*W(?!h)', pick: 'max', min: 5, max: 300 },
      { key: 'pse', label: 'PSE表記', type: 'flag', pattern: 'PSE' },
      { key: 'builtin_cable', label: 'ケーブル内蔵', type: 'flag', pattern: 'ケーブル内蔵|ケーブル一体' },
      { key: 'magnetic', label: 'マグネット式', type: 'flag', pattern: 'MagSafe|マグセーフ|マグネット' },
    ],
    derived: [
      // Nominal 3.6-3.7V cells; airlines use Wh, so agents asked about flights need it.
      { key: 'energy_wh_est', label: '推定電力量', unit: 'Wh', from: 'capacity_mah', formula: (mah) => Math.round((mah * 3.7) / 100) / 10 },
    ],
    guide: {
      summary:
        '普段使いは10000mAh・20W以上、ノートPCも充電するなら20000mAh・45W以上が目安。国内で売られる製品はPSEマークが必須で、' +
        '飛行機は機内持ち込みのみ（預け入れ不可）・100Whを超えると航空会社の承認が要る。',
      criteria: [
        { name: '容量 (mAh)', detail: '表示容量のうち実際にスマホへ入るのは電圧変換ロスで約6〜7割。10000mAhで一般的なスマホを約1.5〜2回充電できる。' },
        { name: '出力 (W)', detail: 'iPhoneの急速充電はUSB PD 20W以上。ノートPCは機種の純正アダプタに近いW数（45〜65W以上）が必要。' },
        { name: '重さ', detail: '10000mAhクラスで約180〜250g、20000mAhクラスで約300〜450g。持ち歩くなら容量より先に重さで絞る。' },
        { name: 'PSEマーク', detail: '2019年2月以降、PSEマークのないモバイルバッテリーは国内で販売できない（電気用品安全法）。表記がない出品は避ける。' },
        { name: '飛行機', detail: '預け入れ不可・機内持ち込みのみ。100Wh以下は制限なし、100Wh超160Wh以下は航空会社の承認が必要（通常2個まで）、160Wh超は持ち込み不可。20000mAh(3.7V)は約74Wh。最新の条件は利用する航空会社で確認する。' },
      ],
      pitfalls: [
        '相場より極端に安い大容量品は、容量表記が実際より大きいことがある。',
        '膨らんだ・熱を持つ・異臭がするものは使用を中止し、自治体やJBRC協力店の回収に出す（燃えないごみに出さない）。',
      ],
    },
  },
  {
    id: 'usb-c-charger',
    name: 'USB-C 充電器 (PD)',
    nameEn: 'USB-C PD charger',
    query: 'USB-C 充電器 PD',
    ngKeywords: ['中古', 'ジャンク', 'シガー'],
    require: '充電器|アダプタ|アダプター',
    exclude: ['ケーブル(単品|のみ)', '車載', 'シガーソケット', 'ワイヤレス充電器'],
    minPrice: 800,
    maxPrice: 15000,
    minReviews: 30,
    facets: [
      { key: 'output_w', label: '最大出力', unit: 'W', type: 'number', pattern: '(\\d{2,3})\\s*W', pick: 'max', min: 5, max: 300 },
      { key: 'ports', label: 'ポート数', unit: '口', type: 'number', pattern: '(\\d)\\s*(?:ポート|口)', pick: 'max', min: 1, max: 8 },
      { key: 'gan', label: 'GaN(窒化ガリウム)', type: 'flag', pattern: 'GaN|窒化ガリウム' },
      { key: 'pps', label: 'PPS対応', type: 'flag', pattern: 'PPS' },
      { key: 'foldable_plug', label: '折りたたみプラグ', type: 'flag', pattern: '折りたたみ|折り畳み' },
    ],
    guide: {
      summary:
        'スマホだけなら20〜30W、ノートPCも充電するなら65W以上が目安。複数ポートは「同時に挿したときの配分」で1ポートあたりの出力が下がる点に注意。',
      criteria: [
        { name: '出力 (W)', detail: 'iPhoneの急速充電は20W以上。ノートPCは純正アダプタと同じかそれ以上のW数を選ぶ（例: 65W、96W）。' },
        { name: '複数ポートの配分', detail: '「合計65W」でも2台同時では45W+20Wなどに分かれる。PCとスマホを同時に充電するなら配分表を確認する。' },
        { name: 'PPS', detail: 'Galaxyなどの「超急速充電」はUSB PDのPPSに対応した充電器が必要。' },
        { name: 'GaN', detail: '窒化ガリウム採用品は同じ出力でも小さく軽い。持ち歩くなら優先する価値がある。' },
        { name: 'ケーブル', detail: '60Wを超える給電には5A対応（e-marker入り）のUSB-Cケーブルが必要。充電器だけ高出力でもケーブルが3Aなら60W止まり。' },
      ],
      pitfalls: [
        'PSEマークのない充電器は国内で販売できない。表記を確認する。',
        '合計出力の数字だけで比べると、1ポートの最大出力が足りないことがある。',
      ],
    },
  },
  {
    id: 'wireless-earphones',
    name: '完全ワイヤレスイヤホン',
    nameEn: 'True wireless earbuds',
    query: 'ワイヤレスイヤホン',
    ngKeywords: ['中古', 'ジャンク', '骨伝導'],
    require: 'イヤホン|イヤフォン',
    exclude: ['^[^ ]{0,20}イヤーピース', '(ケース|カバー)(のみ|単品)', '片耳(のみ|単品)', '交換用', '骨伝導', '有線'],
    minPrice: 2000,
    maxPrice: 50000,
    minReviews: 30,
    facets: [
      { key: 'anc', label: 'ノイズキャンセリング', type: 'flag', pattern: 'ノイズキャンセリング|ノイキャン|ANC' },
      { key: 'ldac', label: 'LDAC', type: 'flag', pattern: 'LDAC' },
      { key: 'aptx', label: 'aptX', type: 'flag', pattern: 'aptX' },
      { key: 'multipoint', label: 'マルチポイント', type: 'flag', pattern: 'マルチポイント' },
      { key: 'ipx', label: '防水等級(IPX)', unit: '', type: 'number', pattern: 'IP[X\\d]?(\\d)', pick: 'max', min: 1, max: 8 },
      { key: 'battery_h', label: '最大再生時間(ケース込みの場合あり)', unit: '時間', type: 'number', pattern: '(?:最大|連続)\\s*(\\d{1,3})\\s*時間', pick: 'max', min: 1, max: 200 },
    ],
    guide: {
      summary:
        '通勤・移動が多いならノイズキャンセリング付き、PCとスマホを行き来するならマルチポイント対応を優先。高音質コーデックはスマホ側の対応で決まる（iPhoneはAACまで）。',
      criteria: [
        { name: 'ノイズキャンセリング', detail: '電車・飛行機・カフェで効果が大きい。効きの強さは機種差が大きいのでレビュー件数の多い機種が無難。' },
        { name: 'コーデック', detail: 'iPhoneはLDAC/aptXに非対応でAACまで。AndroidでLDAC/aptX対応機種なら、同じコーデックに対応したイヤホンで高音質になる。' },
        { name: 'マルチポイント', detail: '2台に同時接続し、PCで会議→スマホに着信などを切り替えなしで受けられる。' },
        { name: '防水', detail: 'IPX4以上で汗や小雨に耐える。運動用ならIPX5以上。' },
        { name: '再生時間', detail: '「最大○時間」はケース充電込みの数字であることが多い。イヤホン単体の連続再生時間を別に確認する。' },
      ],
      pitfalls: [
        '耳の形との相性で装着感と遮音性が大きく変わる。イヤーピースのサイズ違いが付属するか確認する。',
      ],
    },
  },
  {
    id: 'electric-kettle',
    name: '電気ケトル',
    nameEn: 'Electric kettle',
    query: '電気ケトル',
    ngKeywords: ['中古', 'ジャンク'],
    require: 'ケトル',
    exclude: ['(フタ|蓋|パッキン|フィルター)(のみ|単品)', '部品', '交換用'],
    minPrice: 1500,
    maxPrice: 25000,
    minReviews: 30,
    facets: [
      { key: 'capacity_l', label: '容量', unit: 'L', type: 'number', pattern: '(\\d\\.\\d{1,2})\\s*(?:L|l|ℓ|リットル)', pick: 'first', min: 0.3, max: 3 },
      { key: 'watt', label: '消費電力', unit: 'W', type: 'number', pattern: '(\\d{3,4})\\s*W', pick: 'max', min: 300, max: 1500 },
      { key: 'temp_control', label: '温度調節', type: 'flag', pattern: '温度調節|温度設定|温度調整' },
      { key: 'gooseneck', label: '細口(ドリップ向き)', type: 'flag', pattern: '細口|ドリップ|グースネック' },
      { key: 'tip_over_protection', label: '転倒湯もれ防止', type: 'flag', pattern: '転倒.{0,4}(湯漏れ|湯もれ|流水)防止' },
      { key: 'keep_warm', label: '保温', type: 'flag', pattern: '保温' },
    ],
    guide: {
      summary:
        '一人暮らしは0.8L前後、家族は1.0〜1.2Lが目安。小さな子どもがいる家庭は「転倒湯もれ防止」と「本体二重構造」を優先。コーヒーをハンドドリップするなら温度調節＋細口。',
      criteria: [
        { name: '容量', detail: 'カップ1杯は約140〜200ml。0.8Lで4〜5杯、1.2Lで6〜8杯。多すぎる容量は沸くまで時間がかかる。' },
        { name: '安全機能', detail: '空だき防止は多くの製品が標準装備。倒しても湯がこぼれにくい「転倒湯もれ防止」と、外側が熱くなりにくい二重構造は製品差がある。' },
        { name: '温度調節', detail: 'コーヒーは90〜96℃、緑茶は70〜80℃が目安。温度指定できるとお茶・コーヒー・調乳で使い分けられる。' },
        { name: '注ぎ口', detail: 'ハンドドリップには細口（グースネック）が向く。普段使いは注ぎやすい広口で十分。' },
        { name: '消費電力', detail: '1200〜1300W級が多く沸騰は速いが、電子レンジやドライヤーと同時使用するとブレーカーが落ちやすい。' },
      ],
      pitfalls: [
        '内側がプラスチックの製品はにおいが気になることがある。気になる人はステンレス内面を選ぶ。',
      ],
    },
  },
  {
    id: 'humidifier',
    name: '加湿器',
    nameEn: 'Humidifier',
    query: '加湿器',
    ngKeywords: ['中古', 'ジャンク', 'アロマオイル', '抗菌剤'],
    require: '加湿器',
    exclude: ['交換用', '交換フィルター', '(フィルター|カートリッジ|タンク)(のみ|単品)', '部品', '互換'],
    minPrice: 2000,
    maxPrice: 60000,
    minReviews: 30,
    facets: [
      { key: 'rated_ml_h', label: '加湿量', unit: 'mL/h', type: 'number', pattern: '(\\d{3,4})\\s*m[lL]\\s*/\\s*h', pick: 'max', min: 50, max: 3000 },
      { key: 'room_tatami', label: '適用畳数(最大)', unit: '畳', type: 'number', pattern: '(\\d{1,2})\\s*畳', pick: 'max', min: 2, max: 60 },
      { key: 'tank_l', label: 'タンク容量', unit: 'L', type: 'number', pattern: 'タンク.{0,6}?(\\d(?:\\.\\d)?)\\s*(?:L|l|ℓ|リットル)', pick: 'first', min: 0.2, max: 15 },
      { key: 'type_steam', label: 'スチーム式', type: 'flag', pattern: 'スチーム|加熱式' },
      { key: 'type_evaporative', label: '気化式', type: 'flag', pattern: '気化式' },
      { key: 'type_ultrasonic', label: '超音波式', type: 'flag', pattern: '超音波' },
      { key: 'type_hybrid', label: 'ハイブリッド式', type: 'flag', pattern: 'ハイブリッド' },
    ],
    guide: {
      summary:
        '方式で性格がまったく違う。衛生面重視ならスチーム式（電気代は高め）、電気代重視なら気化式、置き場所と価格重視なら超音波式（こまめな手入れが前提）。適用畳数は部屋より一回り大きめを選ぶ。',
      criteria: [
        { name: 'スチーム式', detail: '水を沸かすので雑菌が出にくく加湿力も高い。消費電力は数百Wと大きく、吹出口が熱い製品もある。' },
        { name: '気化式', detail: 'フィルターに風を当てる方式で消費電力が小さく静か。加湿力は室温・湿度に左右され、フィルターの定期的な手入れと交換が必要。' },
        { name: '超音波式', detail: '安く小型で静か。水をそのまま霧にするため、タンクの手入れを怠ると雑菌を撒く。水道水のミネラルで白い粉が出ることがある。' },
        { name: 'ハイブリッド式', detail: '気化式や超音波式にヒーターを組み合わせ、加湿力と消費電力のバランスをとる。価格は高め。' },
        { name: '適用畳数', detail: '「木造和室◯畳/プレハブ洋室◯畳」の2つが書かれ、木造和室のほうが小さい。住まいに合うほうの数字で比べる。' },
      ],
      pitfalls: [
        '交換フィルターの価格と入手性（ランニングコスト）を先に確認する。',
        'タンクの口が狭いと手入れしにくく、衛生面の差になる。',
      ],
    },
  },
  {
    id: 'electric-toothbrush',
    name: '電動歯ブラシ',
    nameEn: 'Electric toothbrush',
    query: '電動歯ブラシ',
    ngKeywords: ['中古', 'ジャンク', '互換'],
    require: '歯ブラシ',
    exclude: ['^[^ ]{0,12}(替え?|交換)ブラシ', '(替え?|交換)ブラシ.{0,6}(本入|本セット|本組|個入)', '互換', '(ヘッド|充電器|スタンド)(のみ|単品)'],
    minPrice: 2000,
    maxPrice: 40000,
    minReviews: 30,
    facets: [
      { key: 'type_sonic', label: '音波式', type: 'flag', pattern: '音波' },
      { key: 'type_rotating', label: '回転式', type: 'flag', pattern: '回転' },
      { key: 'pressure_sensor', label: '押しつけ防止', type: 'flag', pattern: '圧センサー|過圧|押し(つ|付)け(防止|すぎ)' },
      { key: 'timer', label: 'タイマー', type: 'flag', pattern: 'タイマー' },
      { key: 'modes', label: 'モード数', unit: '', type: 'number', pattern: '(\\d)\\s*(?:つの)?モード', pick: 'max', min: 1, max: 9 },
    ],
    guide: {
      summary:
        '本体価格より替えブラシ代（約3か月ごとに交換）が長期の出費を左右する。磨きすぎが心配なら押しつけ防止センサー付き、磨き残しが心配ならタイマー付きを選ぶ。',
      criteria: [
        { name: '方式', detail: '音波式はブラシを高速振動させ、歯に当てて動かす。回転式は丸いヘッドが往復回転し、1本ずつ当てて磨く。どちらが良いかは好みと使い方で分かれる。' },
        { name: '押しつけ防止', detail: '力を入れすぎると歯ぐきや歯を傷めやすい。センサーで知らせる機能があると安心。' },
        { name: 'タイマー', detail: '2分タイマーと、30秒ごとに磨く場所を変える合図があると磨き残しが減る。' },
        { name: '替えブラシ', detail: '約3か月ごとの交換が一般的。純正替えブラシの1本あたり価格×年4本を本体価格に足して比べる。' },
      ],
      pitfalls: [
        '互換ブラシは安いが、メーカー保証の対象外になることがある。',
      ],
    },
  },
];

export const METHOD = {
  version: '2026-09',
  summary:
    'Rakutenで各カテゴリをレビュー件数順に最大60件取得し、除外語・価格帯・最低レビュー件数で絞り、' +
    'ほぼ同じ商品名の重複は最安の1件にまとめる。残りを「ベイズ平均評価」で並べる。',
  formula: 'score = (C × m + n × r) / (C + n)  … r=その商品の平均評価, n=レビュー件数, m=候補全体の平均評価, C=50',
  why:
    'レビュー数件の★5より、数千件の★4.4を上に置くため。件数が少ない商品ほど評価が候補全体の平均に引き寄せられる。',
  picks: {
    best: 'スコア1位',
    budget: 'スコアが候補の上位40%以内の商品のうち最安',
    deal: '過去90日の中央値から最も値下がりしている商品（観測7日以上、異常値は除く）',
  },
  priceVerdict:
    '毎日の価格を記録し、過去90日で観測7日未満は insufficient_data、90日最安値以下なら lowest_90d、' +
    '中央値の90%以下なら below_usual、110%以上なら above_usual、それ以外は usual。',
  caveat: 'スペック(facets)は商品名から機械的に抜き出した参考値で、誤りを含むことがある。購入前に商品ページで確認すること。',
};
