// Categories SHELF tracks. Each one is a Rakuten search plus the rules that
// turn its results into a comparable, honest shortlist:
//
//   query/ngKeywords/minPrice/maxPrice  -> what Rakuten is asked for
//   noun                                -> regex naming the product; titles without it are skipped
//   accessories                         -> words that make a listing an accessory when they come
//                                          before the noun, as "<noun>用", or with のみ/単品
//                                          ("替えブラシ付き" and "フィルター不要" are fine)
//   exclude                             -> regexes that always disqualify a title
//   minReviews                          -> items with fewer reviews are not ranked
//   facets                              -> specs pulled out of titles so agents can filter
//   guide                               -> buying criteria written for this site; it is the
//                                          part an agent quotes when it explains a choice
//
// Facet patterns run against the item title (and caption when present), so
// they are hints, not guarantees; every output says so.

const FURUSATO_GUIDE = {
      asOf: '2026-10',
      summary:
        '返礼品は「寄附1万円あたりどれだけもらえるか」で比べると分かりやすい。ただしふるさと納税は節約ではなく寄附で、自己負担2,000円を超える部分が控除される仕組み。控除の上限は年収や家族構成で変わるので先に確認する。',
      criteria: [
        { name: '寄附1万円あたりの量', detail: '寄附額と内容量（例: 15kg）から計算している。同じ品目でも自治体によって数倍の差があることがある。' },
        { name: '控除の上限', detail: '自己負担2,000円を除いた全額が控除の対象になるのは、年収や家族構成で決まる上限額まで。上限を超えた分は自己負担になる。総務省のページや各ポータルの計算ツールで目安を確認する。' },
        { name: 'ワンストップ特例', detail: '確定申告が不要な給与所得者等で、寄附先が5自治体以内なら、申請書を出すだけで確定申告なしに控除を受けられる。多くの自治体で申請書は翌年1月10日必着。' },
        { name: '返礼品のルール', detail: '返礼品は寄附額の3割以下で、その地域の地場産品に限られる。2025年10月から、ポイントを付与するポータルサイトを通じた募集は禁止された。' },
        { name: '届く時期', detail: '定期便や「◯月以降発送」の品は届くまでに時間がかかる。冷凍品は冷凍庫の空きも確認する。' },
      ],
      pitfalls: ['寄附した年の1月1日〜12月31日の分がその年の控除対象になる。年末は駆け込みで混み合う。', '税の控除額は人によって違う。確実に知りたい場合は自治体や税務署、税理士に確認する。'],
    };

export const CATEGORIES = [
  {
    id: 'mobile-battery',
    name: 'モバイルバッテリー',
    nameEn: 'Power bank',
    query: 'モバイルバッテリー',
    ngKeywords: ['中古', 'ジャンク'],
    noun: 'モバイル\\s*バッテリー',
    accessories: 'ケース|ポーチ|カバー|収納袋',
    exclude: ['セル交換', '部品'],
    minPrice: 1000,
    maxPrice: 20000,
    minReviews: 30,
    facets: [
      { key: 'capacity_mah', label: '容量', unit: 'mAh', type: 'number', pattern: '(\\d{1,3}[,，]?\\d{3})\\s*mAh', pick: 'max', min: 1000, max: 60000 },
      { key: 'output_w', label: '最大出力', unit: 'W', type: 'number', pattern: '(\\d{2,3}(?:\\.\\d)?)\\s*W(?!h)', pick: 'max', min: 5, max: 300 },
      { key: 'energy_wh', label: '電力量(表記)', unit: 'Wh', type: 'number', pattern: '(\\d{2,3}(?:\\.\\d{1,2})?)\\s*Wh', pick: 'max', min: 5, max: 400 },
      { key: 'weight_g', label: '重さ', unit: 'g', type: 'number', pattern: '(\\d{2,4})\\s*g(?![a-z])', pick: 'first', min: 50, max: 1500 },
      { key: 'pse', label: 'PSE表記', type: 'flag', pattern: 'PSE' },
      { key: 'builtin_cable', label: 'ケーブル内蔵', type: 'flag', pattern: 'ケーブル内蔵|ケーブル一体' },
      { key: 'magnetic', label: 'マグネット式', type: 'flag', pattern: 'MagSafe|マグセーフ|マグネット' },
    ],
    derived: [
      // Airlines limit by Wh. Estimate at 3.85V (the high end of common cells)
      // so the estimate errs towards "needs checking", never towards "fine".
      { key: 'energy_wh_est', label: '推定電力量(3.85V換算)', unit: 'Wh', compute: (f) => (f.capacity_mah ? Math.round(f.capacity_mah * 3.85) / 1000 : undefined) },
      {
        key: 'flight_carry_on',
        label: '機内持ち込み目安',
        compute: (f) => {
          const wh = f.energy_wh ?? f.energy_wh_est;
          if (wh == null) return undefined;
          if (wh <= 95) return 'ok';
          if (wh <= 100) return 'check_label';
          if (wh <= 160) return 'airline_approval_needed';
          return 'not_allowed';
        },
      },
      { key: 'energy_wh_source', label: '電力量の根拠', compute: (f) => (f.energy_wh != null ? 'stated' : f.energy_wh_est != null ? 'estimated' : undefined) },
    ],
    guide: {
      asOf: '2026-09',
      summary:
        '普段使いは10000mAh・20W以上、ノートPCも充電するなら20000mAh・45W以上が目安。国内で売られる製品はPSEマークが必須。' +
        '飛行機は預け入れ不可で機内持ち込みのみ、100Whを超えると航空会社の承認が要り、機内での使用・充電を禁じる航空会社も多い。',
      criteria: [
        { name: '容量 (mAh)', detail: '表示容量のうち実際にスマホへ入るのは電圧変換ロスで約6〜7割。10000mAhで一般的なスマホを約1.5〜2回充電できる。' },
        { name: '出力 (W)', detail: 'iPhoneの急速充電はUSB PD 20W以上。ノートPCは機種の純正アダプタに近いW数（45〜65W以上）が必要。' },
        { name: '重さ', detail: '10000mAhクラスで約180〜250g、20000mAhクラスで約300〜450g。持ち歩くなら容量より先に重さで絞る。' },
        { name: 'PSEマーク', detail: '2019年2月以降、PSEマークのないモバイルバッテリーは国内で販売できない（電気用品安全法）。表記がない出品は避ける。' },
        { name: '飛行機', detail: '預け入れ不可・機内持ち込みのみ。一般的な基準は、100Wh以下は承認不要、100Wh超160Wh以下は航空会社の承認が必要（通常2個まで）、160Wh超は持ち込み不可。2025年以降、機内での使用・充電の禁止や個数制限を設ける航空会社が増え、国内線では収納棚に入れず手元に置くよう求められている。Whは本体表記で確認する（20000mAhは約74Wh、27000mAh級は100Wh前後で要確認）。条件は利用する航空会社の最新情報で確認する。' },
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
    noun: '充電器|アダプタ|アダプター',
    accessories: 'ケーブル|変換プラグ',
    exclude: ['車載', 'シガーソケット', 'ワイヤレス充電器'],
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
    noun: 'イヤホン|イヤフォン',
    accessories: 'イヤーピース|イヤーチップ|ケース|カバー|ストラップ',
    exclude: ['骨伝導', '有線イヤホン', '片耳(のみ|単品)'],
    minPrice: 2000,
    maxPrice: 50000,
    minReviews: 30,
    facets: [
      { key: 'anc', label: 'ノイズキャンセリング', type: 'flag', pattern: 'ノイズキャンセリング|ノイキャン|(?<![A-Za-z])ANC(?![A-Za-z])' },
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
    noun: 'ケトル',
    accessories: 'フタ|蓋|パッキン|フィルター',
    exclude: ['部品'],
    minPrice: 1500,
    maxPrice: 25000,
    minReviews: 30,
    facets: [
      { key: 'capacity_l', label: '容量', unit: 'L', type: 'number', pattern: '(?<![\\d.])(\\d\\.\\d{1,2})\\s*(?:L|ℓ|リットル)', alt: [{ pattern: '(?<!\\d)(\\d{3,4})\\s*ml', scale: 0.001 }], pick: 'first', min: 0.3, max: 3 },
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
    noun: '加湿器',
    accessories: '交換用?フィルター|フィルター|カートリッジ',
    exclude: ['互換', '部品', 'タンク(のみ|単品)'],
    minPrice: 2000,
    maxPrice: 60000,
    minReviews: 30,
    facets: [
      { key: 'rated_ml_h', label: '加湿量', unit: 'mL/h', type: 'number', pattern: '(\\d{3,4})\\s*m[lL]\\s*/\\s*h', pick: 'max', min: 50, max: 3000 },
      { key: 'room_tatami', label: '適用畳数(最大)', unit: '畳', type: 'number', pattern: '(\\d{1,2})\\s*畳', pick: 'max', min: 2, max: 60 },
      { key: 'tank_l', label: 'タンク容量', unit: 'L', type: 'number', pattern: 'タンク.{0,6}?(?<![\\d.])(\\d{1,2}(?:\\.\\d)?)\\s*(?:L|ℓ|リットル)', pick: 'first', min: 0.2, max: 15 },
      {
        key: 'type',
        label: '方式',
        type: 'enum',
        // First match wins: hybrids often also say 加熱式 or 超音波.
        options: [
          { value: 'hybrid', label: 'ハイブリッド式', pattern: 'ハイブリッド' },
          { value: 'steam', label: 'スチーム式', pattern: 'スチーム|加熱式' },
          { value: 'evaporative', label: '気化式', pattern: '気化式' },
          { value: 'ultrasonic', label: '超音波式', pattern: '超音波' },
        ],
      },
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
    noun: '歯ブラシ',
    accessories: '替え?ブラシ|交換ブラシ|ブラシヘッド|替えヘッド',
    exclude: ['互換'],
    minPrice: 2000,
    maxPrice: 40000,
    minReviews: 30,
    facets: [
      {
        key: 'type',
        label: '方式',
        type: 'enum',
        options: [
          { value: 'sonic', label: '音波式', pattern: '音波|ソニッケアー|sonicare' },
          { value: 'rotating', label: '回転式', pattern: '回転|オーラルB|Oral-?B' },
        ],
      },
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
  {
    id: 'hair-dryer',
    name: 'ヘアドライヤー',
    nameEn: 'Hair dryer',
    query: 'ヘアドライヤー',
    ngKeywords: ['中古', 'ジャンク', '業務用'],
    noun: 'ドライヤー',
    accessories: 'ノズル|スタンド|ホルダー|フィルター|ディフューザー',
    exclude: ['ペット', '部品', '布団'],
    minPrice: 2000,
    maxPrice: 60000,
    minReviews: 30,
    facets: [
      { key: 'watt', label: '消費電力', unit: 'W', type: 'number', pattern: '(\\d{3,4})\\s*W', pick: 'max', min: 400, max: 1500 },
      { key: 'airflow', label: '風量', unit: 'm³/分', type: 'number', pattern: '(\\d\\.\\d)\\s*(?:m3|m³|㎥)\\s*/\\s*分', pick: 'max', min: 0.5, max: 4 },
      { key: 'ion', label: 'イオン系機能', type: 'flag', pattern: 'イオン|ナノイー|ナノケア' },
      { key: 'temp_control', label: '温度切替', type: 'flag', pattern: '温度調節|温度切替|温冷|スカルプモード|低温' },
      { key: 'foldable', label: '折りたたみ', type: 'flag', pattern: '折りたたみ|折り畳み' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '乾かす速さは風量（m³/分）でほぼ決まる。髪が長い・多いなら風量の大きいモデル、ダメージが気になるなら温度切替付き。イオン系機能の効果は使用感の差が大きく、数値で比べにくい。',
      criteria: [
        { name: '風量', detail: '一般的なモデルは1.3〜1.5m³/分前後、大風量モデルは2m³/分前後。風量が大きいほど乾燥時間が短く、熱を当てる時間も減る。' },
        { name: '温度切替', detail: '熱すぎる風は髪や頭皮の負担になる。低温モードや温冷の切替があると仕上げや夏場に使い分けられる。' },
        { name: '重さ・形', detail: '毎日使うので、持ったときの重さとバランスが満足度を左右する。収納するなら折りたたみ式。' },
        { name: 'イオン系機能', detail: 'ナノイーなどはメーカーごとの独自機能で、効果の感じ方には個人差がある。風量と温度管理を先に比べ、付加機能は好みで選ぶ。' },
        { name: '消費電力', detail: '1200W級が多く、他の家電と同時に使うとブレーカーが落ちることがある。' },
      ],
      pitfalls: ['吸込口にほこりが溜まると風量が落ち、過熱の原因になる。定期的に掃除する。', 'コードを本体に巻き付けて収納すると断線の原因になる。'],
    },
  },
  {
    id: 'rice-cooker',
    name: '炊飯器',
    nameEn: 'Rice cooker',
    query: '炊飯器',
    ngKeywords: ['中古', 'ジャンク', '業務用'],
    noun: '炊飯器|炊飯ジャー',
    accessories: '内釜|内なべ|内ぶた|パッキン|しゃもじ|計量カップ',
    exclude: ['部品', '交換用'],
    minPrice: 3000,
    maxPrice: 120000,
    minReviews: 30,
    facets: [
      { key: 'cups', label: '炊飯容量', unit: '合', type: 'number', pattern: '(\\d{1,2}(?:\\.\\d)?)\\s*合', pick: 'max', min: 1, max: 10 },
      {
        key: 'heating',
        label: '加熱方式',
        type: 'enum',
        options: [
          { value: 'pressure_ih', label: '圧力IH', pattern: '圧力\\s*IH' },
          { value: 'ih', label: 'IH', pattern: 'IH' },
          { value: 'microcomputer', label: 'マイコン', pattern: 'マイコン' },
        ],
      },
      { key: 'timer', label: '予約タイマー', type: 'flag', pattern: '予約' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '一人暮らしは3合、2〜4人は5.5合、5人以上は1升が目安。安さ優先ならマイコン、炊き上がり重視ならIH、もちもち感を求めるなら圧力IH。高価格帯の差は内釜の素材と火力。',
      criteria: [
        { name: '容量', detail: '最大容量の半分くらいの量を炊くことが多いなら、ひと回り小さいほうが炊きムラが少ない。' },
        { name: '加熱方式', detail: 'マイコンは底のヒーターで加熱し安価。IHは釜全体を加熱して火力が強い。圧力IHは圧力をかけて高温で炊き、もっちりしやすい。' },
        { name: '内釜', detail: '厚い釜や土鍋・鉄・銅などの素材で蓄熱性が変わる。価格差の多くはここ。' },
        { name: '手入れ', detail: '毎回洗う部品の数（内ぶた・蒸気口）が少ないほど続けやすい。' },
        { name: '保温', detail: '長時間の保温は黄ばみや乾燥が出やすい。冷凍保存するなら保温性能より炊き上がりを重視する。' },
      ],
      pitfalls: ['内釜のコーティングは傷むと交換費用がかかる。交換用内釜の価格も見ておく。'],
    },
  },
  {
    id: 'air-purifier',
    name: '空気清浄機',
    nameEn: 'Air purifier',
    query: '空気清浄機',
    ngKeywords: ['中古', 'ジャンク', '車載'],
    noun: '空気清浄機',
    accessories: '交換用?フィルター|フィルター|カートリッジ',
    exclude: ['互換', '部品', '車載'],
    minPrice: 5000,
    maxPrice: 120000,
    minReviews: 30,
    facets: [
      { key: 'room_tatami', label: '適用床面積(最大)', unit: '畳', type: 'number', pattern: '(\\d{1,2})\\s*畳', pick: 'max', min: 4, max: 80 },
      { key: 'humidify', label: '加湿機能', type: 'flag', pattern: '加湿' },
      { key: 'hepa', label: 'HEPAフィルター', type: 'flag', pattern: 'HEPA' },
      { key: 'ion', label: 'イオン系機能', type: 'flag', pattern: 'プラズマクラスター|ナノイー|ストリーマ' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '適用床面積は使う部屋の2〜3倍を目安に選ぶと、早くきれいにできて静かな運転で済む。加湿機能付きは便利だが手入れが増える。本体価格よりフィルター交換費用まで含めて比べる。',
      criteria: [
        { name: '適用床面積', detail: '日本電機工業会の規格（JEM1467）で、決められた量の粉じんを30分で除去できる広さとして表示される。部屋より広めを選ぶほど早く清浄できる。' },
        { name: 'フィルター', detail: 'HEPA系の集じんフィルターは細かな粒子をよく捕らえる。「10年交換不要」などの表示は試験条件での目安で、使い方によって短くなる。' },
        { name: '加湿機能', detail: '1台で済むが、加湿トレーやフィルターの手入れが必要になる。手入れを怠ると衛生面の問題になる。' },
        { name: '運転音', detail: '寝室で使うなら静音モードの騒音値（dB）を確認する。' },
        { name: 'ランニングコスト', detail: '交換用フィルターの価格と交換目安、電気代を足して比べる。' },
      ],
      pitfalls: ['互換フィルターは安いが、性能や安全性の保証がないことがある。'],
    },
  },
  {
    id: 'robot-vacuum',
    name: 'ロボット掃除機',
    nameEn: 'Robot vacuum',
    query: 'ロボット掃除機',
    ngKeywords: ['中古', 'ジャンク'],
    noun: 'ロボット掃除機|ロボットクリーナー',
    accessories: 'ブラシ|フィルター|ダストバッグ|紙パック|モップパッド|バッテリー|交換',
    exclude: ['互換', '部品', '消耗品'],
    minPrice: 8000,
    maxPrice: 250000,
    minReviews: 30,
    facets: [
      { key: 'suction_pa', label: '吸引力', unit: 'Pa', type: 'number', pattern: '(\\d{3,5})\\s*Pa', pick: 'max', min: 500, max: 30000 },
      { key: 'mapping', label: 'マッピング', type: 'flag', pattern: 'LiDAR|ライダー|レーザー|マッピング' },
      { key: 'mop', label: '水拭き', type: 'flag', pattern: '水拭き|モップ' },
      { key: 'auto_empty', label: '自動ゴミ収集', type: 'flag', pattern: '自動ゴミ収集|自動ゴミ捨て|クリーンベース|ゴミ収集ステーション' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '部屋の地図を作るマッピング機能があると、掃除漏れが減り部屋ごとの指定ができる。手間を減らしたいなら自動ゴミ収集付き。吸引力（Pa）の数値はメーカー間で測り方が揃っていないので参考程度に。',
      criteria: [
        { name: 'マッピング', detail: 'LiDAR（レーザー）やカメラで部屋の地図を作る機種は、効率よく走り、進入禁止エリアや部屋単位の掃除を設定できる。' },
        { name: '本体の高さ', detail: 'ソファやベッドの下を掃除したいなら、家具の下の隙間と本体の高さを比べる。' },
        { name: '自動ゴミ収集', detail: '充電台がゴミを吸い取る機種は、ゴミ捨てが数週間に1回で済む。台は大きく、紙パックの費用がかかる。' },
        { name: '水拭き', detail: 'フローリング中心なら便利。カーペットがある家では、モップを持ち上げる機能があるか確認する。' },
        { name: '消耗品', detail: 'ブラシ・フィルター・紙パックの交換費用と入手しやすさを確認する。' },
      ],
      pitfalls: ['床のケーブルや小物を巻き込むことがある。使う前に床を片付ける習慣が必要。', 'アプリ連携の機種は、メーカーのサービス終了で機能が使えなくなる可能性がある。'],
    },
  },
  {
    id: 'rice',
    name: '米（白米）',
    nameEn: 'Rice',
    query: '米 白米 5kg',
    ngKeywords: ['中古', '米粉', '米ぬか', 'パックご飯', 'レトルト'],
    noun: '米|こめ|コシヒカリ|あきたこまち|ひとめぼれ|ななつぼし|ゆめぴりか|つや姫|はえぬき|ヒノヒカリ|まっしぐら',
    exclude: ['玄米', 'もち米', '米粉', '米ぬか', '麹', 'パックご飯', 'レトルト', '雑穀', '定期便'],
    excludeRaw: ['ふるさと納税', '返礼品'],
    minPrice: 1500,
    maxPrice: 40000,
    minReviews: 20,
    unitPrice: { kind: 'mass', per: 1000, min: 1000, max: 60000, label: '1kgあたり' },
    facets: [
      { key: 'crop_year', label: '産年(令和)', unit: '年産', type: 'number', pattern: '令和\\s*(\\d)\\s*年産', pick: 'max', min: 1, max: 9 },
      { key: 'musenmai', label: '無洗米', type: 'flag', pattern: '無洗米' },
      { key: 'blend', label: 'ブレンド米', type: 'flag', pattern: 'ブレンド|複数原料米' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '比べるなら1kgあたりの価格で。銘柄・産年・単一原料米かブレンドかで味と価格が変わる。研ぐ手間と水を省くなら無洗米（同じ重さでやや割高になりやすい）。',
      criteria: [
        { name: '1kgあたり価格', detail: '5kg・10kg・5kg×2袋など容量がばらばらなので、総量で割った単価で比べる。送料別の商品は送料込みで計算し直す。' },
        { name: '産年・精米日', detail: '「令和◯年産」が新しいほど新米に近い。精米後は風味が落ちていくので、精米日が新しいものを少量ずつ買うほうがおいしく食べられる。' },
        { name: '単一原料米とブレンド', detail: '「単一原料米」は産地・品種・産年が同じ米だけのもの。ブレンド米は価格が安めで、味は銘柄米より劣ることが多い。' },
        { name: '無洗米', detail: '研がずに炊ける。研ぎ汁が出ず手間と水を節約できる。精米で取り除く分があるため、同じ重さなら少し割高になりやすい。' },
        { name: '保存', detail: '高温多湿を避け、密閉容器で保存する。夏場は冷蔵庫の野菜室が向く。1か月程度で食べ切れる量を目安に。' },
      ],
      pitfalls: ['「5kg×2」と「10kg」は同じ量。袋が分かれていると保存しやすい。', '定期便やふるさと納税の返礼品は別の比較になる（ここでは通常の購入のみを比べている）。'],
    },
  },
  {
    id: 'mineral-water',
    name: 'ミネラルウォーター（箱買い）',
    nameEn: 'Bottled water',
    query: 'ミネラルウォーター 2L 箱',
    ngKeywords: ['中古', 'ウォーターサーバー', '浄水器', '炭酸'],
    noun: '水|ウォーター|ウオーター',
    exclude: ['ウォーターサーバー', '浄水', '炭酸', 'スパークリング', 'カートリッジ', '水素水', 'ボトル(のみ|単品)', '空ボトル'],
    minPrice: 800,
    maxPrice: 10000,
    minReviews: 20,
    unitPrice: { kind: 'volume', per: 1000, min: 4000, max: 100000, label: '1Lあたり' },
    facets: [
      { key: 'hardness', label: '硬度', unit: 'mg/L', type: 'number', pattern: '硬度\\s*(?:約)?\\s*(\\d{1,4})', pick: 'first', min: 1, max: 2000 },
      { key: 'bottle_l', label: '1本の容量', unit: 'L', type: 'number', pattern: '(\\d(?:\\.\\d{1,2})?)\\s*L', alt: [{ pattern: '(\\d{3,4})\\s*ml', scale: 0.001 }], pick: 'first', min: 0.2, max: 12 },
      { key: 'label_less', label: 'ラベルレス', type: 'flag', pattern: 'ラベルレス' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '比べるなら1Lあたりの価格で。普段飲み・料理には軟水、ミネラル感が欲しければ中硬水〜硬水。重いので送料込みかどうかで実質価格が大きく変わる。',
      criteria: [
        { name: '1Lあたり価格', detail: '2L×6本・2L×9本・500ml×24本など入数が違うので、総量で割って比べる。一般に2Lのほうが500mlより割安。' },
        { name: '硬度', detail: '日本では硬度（mg/L）がおよそ100未満を軟水、100〜300を中硬水、300以上を硬水と呼ぶことが多い。日本茶やだしには軟水が向く。' },
        { name: '送料', detail: '水は重く、送料別だと単価の差が逆転しやすい。送料込みの商品で比べる。' },
        { name: '備蓄', detail: '災害への備えとして、飲みながら買い足す「ローリングストック」が勧められている。賞味期限が長い保存水もある。' },
      ],
      pitfalls: ['ラベルレス商品は分別しやすいが、硬度などの表示が箱にしかないことがある。'],
    },
  },
  {
    id: 'toilet-paper',
    name: 'トイレットペーパー',
    nameEn: 'Toilet paper',
    query: 'トイレットペーパー まとめ買い',
    ngKeywords: ['中古', 'ホルダー'],
    noun: 'トイレットペーパー|トイレットロール|トイレットティッシュ',
    exclude: ['ホルダー', 'ケース', 'カバー', 'ストッカー', 'ボックスティッシュ', '流せる'],
    minPrice: 800,
    maxPrice: 15000,
    minReviews: 20,
    unitPrice: { kind: 'paper', per: 100, min: 300, max: 20000, label: '100mあたり（シングル換算）' },
    facets: [
      { key: 'rolls', label: 'ロール数', unit: 'ロール', type: 'number', pattern: '(\\d{1,3})\\s*ロール', pick: 'first', min: 4, max: 200 },
      { key: 'roll_m', label: '1ロールの長さ', unit: 'm', type: 'number', pattern: '(\\d{2,3}(?:\\.\\d)?)\\s*m(?![lm])', pick: 'first', min: 15, max: 300 },
      {
        key: 'ply',
        label: '巻き',
        type: 'enum',
        options: [
          { value: 'double', label: 'ダブル', pattern: 'ダブル|2枚重ね' },
          { value: 'single', label: 'シングル', pattern: 'シングル' },
        ],
      },
      { key: 'long_roll', label: '長尺(◯倍巻き)', type: 'flag', pattern: '\\d(?:\\.\\d)?倍巻' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        'シングルとダブルは長さで単純に比べられない（ダブルは2枚重ね）。ここではダブルの長さを2倍した「シングル換算100mあたり」で比べている。長尺タイプは交換回数と収納場所が減る。',
      criteria: [
        { name: 'シングル換算の単価', detail: 'ダブルは2枚重ねなので、紙の量はシングルの2倍の長さに相当する。ロール数×長さ×（ダブルなら2）で総量を出して比べる。' },
        { name: '長尺タイプ', detail: '「2倍巻き」「3倍巻き」は交換の手間と収納場所が減る。ロールの直径が大きくなるので、ホルダーに収まるか確認する。' },
        { name: '肌ざわり', detail: 'パルプ100%は柔らかめ、再生紙（古紙配合）は価格が安めで環境負荷が小さい。' },
        { name: '収納', detail: '大量パックは割安でも置き場所が必要。届く箱の大きさを考えて選ぶ。' },
      ],
      pitfalls: ['ロールの長さが書かれていない商品は単価を計算できないため、単価ランキングから外している。'],
    },
  },
  {
    id: 'aa-batteries',
    name: '単3アルカリ乾電池',
    nameEn: 'AA alkaline batteries',
    query: '単3 アルカリ乾電池',
    ngKeywords: ['中古', '充電器', '充電式'],
    noun: '電池',
    exclude: ['単[1245]', '充電', 'ニッケル水素', 'エネループ', 'eneloop', 'リチウム', 'ボタン', 'ケース', 'ホルダー', 'ボックス', 'チェッカー'],
    minPrice: 300,
    maxPrice: 8000,
    minReviews: 20,
    unitPrice: { kind: 'count', per: 1, min: 2, max: 500, label: '1本あたり' },
    facets: [
      { key: 'shelf_life_y', label: '使用推奨期限', unit: '年', type: 'number', pattern: '(\\d{1,2})\\s*年(?:保存|長期保存|間保存)', pick: 'max', min: 2, max: 20 },
      { key: 'leak_proof', label: '液漏れ防止', type: 'flag', pattern: '液漏れ防止|液もれ防止' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '比べるなら1本あたりの価格で。リモコンや時計など低消費の機器なら安いまとめ買いで十分、カメラやおもちゃなど電流を多く使う機器は高性能品や充電池も検討する。',
      criteria: [
        { name: '1本あたり価格', detail: '4本・20本・40本など入数が違うので、本数で割って比べる。' },
        { name: '使用推奨期限', detail: '製造からの保存期間の目安。備蓄用なら期限が長いものを選び、期限内に使い回す。' },
        { name: '用途', detail: '電流を多く使う機器（ゲームコントローラー、カメラのストロボなど）は電池の減りが早い。頻繁に交換するなら充電式電池のほうが長期的に安くなることがある。' },
        { name: '液漏れ', detail: '使い切った電池や長期間使わない機器の電池は外しておくと、液漏れによる故障を防げる。' },
      ],
      pitfalls: ['新しい電池と古い電池、種類の違う電池を混ぜて使わない。', '捨てるときは端子をテープで絶縁し、自治体の分別に従う。'],
    },
  },
  {
    id: 'coffee-beans',
    name: 'コーヒー豆',
    nameEn: 'Coffee beans',
    query: 'コーヒー豆',
    ngKeywords: ['中古', 'インスタント', 'ドリップバッグ'],
    noun: 'コーヒー|珈琲',
    exclude: ['ドリップバッグ', 'インスタント', 'カプセル', 'ミル', 'ドリッパー', 'フィルター', 'ペットボトル', '缶', 'ボトル', '生豆', 'スティック', 'カフェオレベース', 'ギフト券'],
    minPrice: 800,
    maxPrice: 15000,
    minReviews: 20,
    unitPrice: { kind: 'mass', per: 100, min: 100, max: 5000, label: '100gあたり' },
    facets: [
      {
        key: 'roast',
        label: '焙煎度',
        type: 'enum',
        options: [
          { value: 'dark', label: '深煎り', pattern: '深煎り|深煎|フレンチ|イタリアン' },
          { value: 'medium', label: '中煎り', pattern: '中煎り|中深煎り|シティ' },
          { value: 'light', label: '浅煎り', pattern: '浅煎り|浅煎|シナモン' },
        ],
      },
      {
        key: 'form',
        label: '豆/粉',
        type: 'enum',
        options: [
          { value: 'ground', label: '粉（挽き済み）', pattern: '粉|挽き|グラインド' },
          { value: 'beans', label: '豆のまま', pattern: '豆のまま|豆の状態|ホールビーン|豆' },
        ],
      },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '比べるなら100gあたりの価格で。香りを長く楽しむなら豆のまま買って飲む直前に挽く。苦味とコクが好きなら深煎り、酸味と香りを楽しむなら浅煎り。',
      criteria: [
        { name: '100gあたり価格', detail: '200g・500g×2・1kgなど容量が違うので、総量で割って比べる。' },
        { name: '豆か粉か', detail: '挽いた粉は表面積が大きく、香りが早く抜ける。ミルがあるなら豆のままのほうが鮮度を保ちやすい。' },
        { name: '焙煎度', detail: '浅煎りは酸味と華やかな香り、深煎りは苦味とコク。中煎りはその中間。' },
        { name: '鮮度', detail: '焙煎後は時間とともに香りが落ちる。焙煎日が書かれた商品を選び、開封後は密閉して早めに飲み切る。' },
      ],
      pitfalls: ['大容量は割安でも、飲み切るまでに風味が落ちる。1か月程度で飲み切れる量が目安。'],
    },
  },
  {
    id: 'protein',
    name: 'プロテイン（パウダー）',
    nameEn: 'Protein powder',
    query: 'プロテイン ホエイ 1kg',
    ngKeywords: ['中古', 'シェイカー', 'お試し'],
    noun: 'プロテイン',
    exclude: ['シェイカー', 'バー', 'ドリンク', 'クッキー', 'ゼリー', 'お試し', '試供品', '1食分', 'スプーン', 'ケース'],
    minPrice: 1500,
    maxPrice: 25000,
    minReviews: 20,
    unitPrice: { kind: 'mass', per: 1000, min: 300, max: 10000, label: '1kgあたり' },
    facets: [
      {
        key: 'type',
        label: '種類',
        type: 'enum',
        options: [
          { value: 'wpi', label: 'ホエイ(WPI)', pattern: 'WPI|アイソレート' },
          { value: 'whey', label: 'ホエイ', pattern: 'ホエイ|WPC|whey' },
          { value: 'soy', label: 'ソイ', pattern: 'ソイ|大豆' },
          { value: 'casein', label: 'カゼイン', pattern: 'カゼイン' },
        ],
      },
      { key: 'no_artificial_sweetener', label: '人工甘味料不使用', type: 'flag', pattern: '人工甘味料不使用|甘味料不使用|無添加' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        '比べるなら1kgあたりの価格で。ただし製品ごとにたんぱく質の含有率（多くは7〜9割）が違うので、栄養成分表示で1食あたりのたんぱく質量も確認する。',
      criteria: [
        { name: '1kgあたり価格', detail: '1kg・3kg・1kg×2など容量が違うので、総量で割って比べる。大容量ほど割安なことが多い。' },
        { name: '種類', detail: 'ホエイは牛乳由来で吸収が速い。WPIは乳糖を減らした精製度の高いホエイで、お腹がゆるくなりやすい人向け。ソイは大豆由来で吸収がゆっくり。' },
        { name: 'たんぱく質含有率', detail: '同じ1kgでもたんぱく質の量は製品で違う。1食あたりのたんぱく質量と価格から、たんぱく質1gあたりの費用で比べるのが最も公平。' },
        { name: '甘味料・添加物', detail: '人工甘味料を避けたい人向けの無添加・プレーンタイプもある。味は落ちるが料理にも使いやすい。' },
      ],
      pitfalls: ['競技者はドーピング検査の対象になる成分の混入リスクがある。第三者認証（インフォームドチョイスなど）の有無を確認する。', '持病がある人やたんぱく質摂取量に制限がある人は医師に相談する。'],
    },
  },
  {
    id: 'sonicare-heads',
    name: 'ソニッケアー純正替えブラシ',
    nameEn: 'Sonicare brush heads',
    query: 'ソニッケアー 替えブラシ 純正',
    ngKeywords: ['中古', '互換'],
    noun: '替え?ブラシ|ブラシヘッド',
    exclude: ['互換', '汎用', '対応(?!.*純正)', 'Philips\\s*One', 'フィリップスワン', 'エッセンス'],
    require2: 'ソニッケアー|Sonicare|フィリップス|Philips',
    minPrice: 1000,
    maxPrice: 20000,
    minReviews: 10,
    unitPrice: { kind: 'count', per: 1, min: 1, max: 30, label: '1本あたり' },
    facets: [
      { key: 'heads', label: '本数', unit: '本', type: 'number', pattern: '(\\d{1,2})\\s*本', pick: 'max', min: 1, max: 30 },
      { key: 'genuine', label: '純正表記', type: 'flag', pattern: '純正|正規品' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        'はめ込み式のソニッケアー替えブラシは、ほとんどのソニッケアー充電式本体に使える（Philips One と旧エッセンスは別）。比べるなら1本あたりの価格で。約3か月ごとの交換が目安。',
      criteria: [
        { name: '本体との互換', detail: 'メーカーによると、標準的なはめ込み式ブラシヘッドはほとんどのソニッケアー充電式歯ブラシに使える。Philips One は専用ヘッドのみ、旧エッセンスはねじ込み式。' },
        { name: '1本あたり価格', detail: '2本・4本・8本入りなど入数が違うので、本数で割って比べる。まとめ買いほど割安なことが多い。' },
        { name: 'ヘッドの種類', detail: '歯垢除去・ホワイトニング・歯ぐきケアなど目的別の種類がある。普段使いなら標準タイプで十分。' },
        { name: '純正か互換か', detail: 'ここでは純正品だけを比べている。互換品は安いがメーカー保証の対象外になることがある。' },
      ],
      pitfalls: ['毛先が開いてきたら3か月を待たずに交換する。', '本体の型番がわからないときは、本体底面か取扱説明書で確認する。'],
    },
  },
  {
    id: 'oralb-heads',
    name: 'ブラウン オーラルB 純正替えブラシ（丸型）',
    nameEn: 'Oral-B brush heads (round)',
    query: 'ブラウン オーラルB 替えブラシ 純正',
    ngKeywords: ['中古', '互換'],
    noun: '替え?ブラシ|ブラシヘッド',
    exclude: ['互換', '汎用', '対応(?!.*純正)', '\\biO\\b', 'iO専用', 'ソニック', 'パルソニック'],
    require2: 'ブラウン|オーラルB|オーラルビー|Oral-?B|Braun',
    minPrice: 1000,
    maxPrice: 20000,
    minReviews: 10,
    unitPrice: { kind: 'count', per: 1, min: 1, max: 30, label: '1本あたり' },
    facets: [
      { key: 'heads', label: '本数', unit: '本', type: 'number', pattern: '(\\d{1,2})\\s*本', pick: 'max', min: 1, max: 30 },
      { key: 'genuine', label: '純正表記', type: 'flag', pattern: '純正|正規品' },
    ],
    guide: {
      asOf: '2026-10',
      summary:
        'ブラウン オーラルBの丸型替えブラシは、iOシリーズ以外の回転式本体に使える（iOは専用ブラシのみ、楕円型は別の機種用）。比べるなら1本あたりの価格で。約3か月ごとの交換が目安。',
      criteria: [
        { name: '本体との互換', detail: 'メーカーによると、替えブラシはブラウン（オーラルB）の電動歯ブラシ本体に装着できるが、iOシリーズには専用の替えブラシがあり互換性はない。丸型と楕円型は対応する本体が異なる。' },
        { name: '1本あたり価格', detail: '入数が違うので本数で割って比べる。' },
        { name: 'ブラシの種類', detail: '歯垢除去・ホワイトニング・やわらかめなどの種類がある。歯ぐきが弱い人はやわらかめを選ぶ。' },
        { name: '純正か互換か', detail: 'ここでは純正品だけを比べている。互換品は安いがメーカー保証の対象外になることがある。' },
      ],
      pitfalls: ['ブラシ根元の色付きの毛が薄くなったら交換の合図（インジケーター付きのブラシの場合）。'],
    },
  },
  {
    id: 'furusato-rice',
    sources: ['rakuten'],
    name: 'ふるさと納税：米',
    nameEn: 'Furusato nozei: rice',
    langs: ['ja'],
    query: 'ふるさと納税 米 10kg',
    ngKeywords: ['中古', '米粉', 'パックご飯'],
    noun: '米|こめ|コシヒカリ|あきたこまち|ひとめぼれ|ななつぼし|ゆめぴりか|つや姫|はえぬき|ヒノヒカリ|まっしぐら',
    requireRaw: 'ふるさと納税',
    exclude: ['米粉', '米ぬか', '麹', 'パックご飯', 'レトルト', '雑穀', '日本酒', '焼酎'],
    minPrice: 5000,
    maxPrice: 100000,
    minReviews: 10,
    unitPrice: { kind: 'mass', per: 1000, perYen: 10000, min: 1000, max: 120000, label: '寄附1万円あたり（kg）' },
    facets: [
      { key: 'crop_year', label: '産年(令和)', unit: '年産', type: 'number', pattern: '令和\\s*(\\d)\\s*年産', pick: 'max', min: 1, max: 9 },
      { key: 'musenmai', label: '無洗米', type: 'flag', pattern: '無洗米' },
      { key: 'subscription', label: '定期便', type: 'flag', pattern: '定期便' },
    ],
    guide: FURUSATO_GUIDE,
  },
  {
    id: 'furusato-toilet-paper',
    sources: ['rakuten'],
    name: 'ふるさと納税：トイレットペーパー',
    nameEn: 'Furusato nozei: toilet paper',
    langs: ['ja'],
    query: 'ふるさと納税 トイレットペーパー',
    ngKeywords: ['中古', 'ホルダー'],
    noun: 'トイレットペーパー|トイレットロール',
    requireRaw: 'ふるさと納税',
    exclude: ['ホルダー', 'ケース', 'カバー', 'ボックスティッシュ'],
    minPrice: 5000,
    maxPrice: 100000,
    minReviews: 10,
    unitPrice: { kind: 'paper', per: 100, perYen: 10000, min: 300, max: 50000, label: '寄附1万円あたり（シングル換算100m）' },
    facets: [
      { key: 'rolls', label: 'ロール数', unit: 'ロール', type: 'number', pattern: '(\\d{1,3})\\s*ロール', pick: 'first', min: 4, max: 300 },
      {
        key: 'ply',
        label: '巻き',
        type: 'enum',
        options: [
          { value: 'double', label: 'ダブル', pattern: 'ダブル|2枚重ね' },
          { value: 'single', label: 'シングル', pattern: 'シングル' },
        ],
      },
    ],
    guide: FURUSATO_GUIDE,
  },
  {
    id: 'furusato-beef',
    sources: ['rakuten'],
    name: 'ふるさと納税：牛肉（切り落とし・こま切れ）',
    nameEn: 'Furusato nozei: beef',
    langs: ['ja'],
    query: 'ふるさと納税 牛肉 切り落とし',
    ngKeywords: ['中古'],
    noun: '牛',
    requireRaw: 'ふるさと納税',
    exclude: ['ハンバーグ', 'コロッケ', 'メンチ', 'ジャーキー', 'カレー', '牛タン', 'ホルモン', 'ステーキ', '定期便'],
    minPrice: 5000,
    maxPrice: 100000,
    minReviews: 10,
    unitPrice: { kind: 'mass', per: 1000, perYen: 10000, min: 200, max: 20000, label: '寄附1万円あたり（kg）' },
    facets: [
      { key: 'wagyu', label: '和牛', type: 'flag', pattern: '和牛|黒毛' },
      { key: 'domestic', label: '国産', type: 'flag', pattern: '国産' },
    ],
    guide: FURUSATO_GUIDE,
  },
];

export const METHOD = {
  version: '2026-09',
  summary:
    'Rakutenで各カテゴリをレビュー件数順に最大60件取得し、除外語・価格帯・最低レビュー件数で絞り、' +
    '同じ商品の別ショップ出品（型番が同じ、またはスペックが同じで商品名がほぼ同じもの）は評価の高い1件にまとめ、他店の価格は other_offers に残す。残りを「ベイズ平均評価」で並べる。',
  formula: 'score = (C × m + n × r) / (C + n)  … r=その商品の平均評価, n=レビュー件数, m=候補全体の平均評価, C=50',
  why:
    'レビュー数件の★5より、数千件の★4.4を上に置くため。件数が少ない商品ほど評価が候補全体の平均に引き寄せられる。',
  picks: {
    best: 'スコア1位',
    budget: 'スコアが候補の上位40%以内の商品のうち最安',
    deal: '価格判定が「いつもより安い」以上の商品のうち、中央値からの値下がり率が最大のもの（異常値・容量などを選べる出品は除く）',
  },
  priceVerdict:
    '毎日の価格（送料込/別が今日と同じ日だけ）を記録し、観測7日未満は insufficient_data。中央値より3%以上安く観測期間の最安値なら lowest_observed、' +
    '中央値の90%以下なら below_usual、110%以上なら above_usual、それ以外は usual。観測期間は最大90日で window_days に示す。',
  caveat: 'スペック(facets)は商品名から機械的に抜き出した参考値で、誤りを含むことがある。購入前に商品ページで確認すること。',
};
