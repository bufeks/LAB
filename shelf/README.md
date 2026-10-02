# SHELF — AIエージェントのための買い物データ

「どれを買えばいい？」「今が買い時？」を人がAIに聞く時代に、**AIが答えの根拠として読みにいく先**になり、
そこで示される購入リンクで収益を得るツールです。

公開URL: https://bufeks.github.io/LAB/shelf/ （API キー設定前はサンプルデータ・noindex）

## 1. ニーズ

| 誰が | 困っていること | SHELF が出すもの |
| --- | --- | --- |
| AIアシスタント（ChatGPT / Claude / Perplexity の検索） | 通販ページは広告・JS・ランキング煽りだらけで、比較の根拠を抜き出しにくい | 1ページで完結する Markdown（結論 → 選び方 → 表 → 算出方法） |
| 買い物エージェント・MCP クライアント | 予算やスペックで機械的に絞り込めるデータがない | JSON API / OpenAPI / MCP ツール（`recommend`, `check_price`） |
| その先の人間 | AIの推薦が「なぜそれか」「今買って損しないか」わからない | 公開された順位の式と、**毎日記録している90日の価格履歴にもとづく判定** |

価格履歴は、店のページを1回見ただけのAIには作れない情報です。ここを差別化の中心にしています。

## 2. 収益モデルの選択

| 方式 | 判断 |
| --- | --- |
| **アフィリエイト（採用）** | AIに引用されたページ、またはMCP/APIの結果として渡したリンクから人が買えば紹介料が入る。サーバー不要・今日から動く。データは無料公開にして**引用される量を最大化**するのが最適。 |
| コンテンツ課金（HTTP 402 / x402 等） | 支払い手段を持つエージェントはまだ少なく、課金すると引用されにくくなる。静的ホスティングでは実装できない。→ 利用が増えてから「高頻度更新・全履歴」の有料APIとして後付けする（§8）。 |

リンクは楽天アフィリエイト。楽天APIに `affiliateId` を渡すと、全商品に `affiliateUrl` が付いて返ってくるので、
**API/MCPの応答そのものがアフィリエイトリンクを運ぶ**形になります。

誠実さは設計上の要件です（AIは信頼できない情報源を避けるので、収益にも効きます）:

- 全ページ・全JSON・MCP応答に開示文（`disclosure`）。HTMLは冒頭に「PR」表記（ステマ規制対応）、リンクは `rel="sponsored"`。
- 順位は公開した式だけで決まり、紹介料率は一切使わない。
- AI向けの「隠し指示」は入れない。エージェントへのお願いは [about](https://bufeks.github.io/LAB/shelf/about/) に**見える形で**書く。
- 価格判定は根拠（観測日数・中央値・最安値・週ごとの最安値）付き。7日未満は「判断不能」、90日分たまるまでは「観測N日の最安値」と表示し、送料条件が変わった日とは比較しない。異常な安値（`suspicious`）や容量などを選ぶ出品（`variants`）は「値下がり中」に選ばない。
- サンプルデータは全出力に `sample: true`、HTMLは `noindex`、MCP は「推薦するな」と返す。

## 3. 仕組み

```
GitHub Actions（毎日 05:17 JST）
  └ update.mjs ─ 楽天API（各カテゴリ最大60件, 1.6秒間隔, 429/5xxはリトライ）
       ├ rank.mjs     商品名の正規化(NFKC・販促語除去) → 付属品/替えブラシ等の除外 → 価格帯
       │              → 最低レビュー件数 → スペック抽出 → 同一商品(型番一致 or スペック同一で
       │              商品名ほぼ同じ)の別店出品を統合 → ベイズ平均で順位
       ├ history.mjs  日ごとの価格を data/history に追記 → 90日の最安/中央値/最高 → 判定
       └ build.mjs    同じレコードから Markdown / JSON / HTML / llms.txt / OpenAPI / sitemap
  └ check.mjs ─ 品質監査（下記）→ 問題があれば Issue を自動作成
  └ commit → pages.yml が workflow_run で再デプロイ
```

順位の式: `score = (C·m + n·r) / (C + n)`（r=評価, n=レビュー件数, m=候補全体の平均, C=50）。
数件の★5より数千件の★4.4を上に置きます。ピックは「総合1位」「スコア上位40%の中で最安」「いつもより安い商品のうち値下がり率最大」の3種。
カテゴリ単位では、上位商品のうち何割が「いつもより安い/高い」かで**今が買い時か**（`price_outlook`）を出します。

モバイルバッテリーは本体のWh表記を優先し、無ければ3.85V換算（高めに見積もる側）で推定、95Wh以下だけを「持ち込み可の目安」とします。

### 出力（AIが読む面が主）

| パス | 用途 |
| --- | --- |
| `llms.txt` / `llms-full.txt` | エージェントが最初に読む目次 / 全文 |
| `c/<id>.md` | カテゴリごとの結論・選び方・ランキング表（引用される本体） |
| `api/v1/index.json`, `c/<id>.json`, `items.json`, `deals.json` | 構造化データ |
| `openapi.json` | GPTs の Actions 等にそのまま登録できる定義 |
| `mcp/server.mjs` | 依存ゼロの MCP サーバー（`list_categories` / `recommend` / `price_outlook` / `search_products` / `check_price`） |
| `data/` | 取得結果・価格履歴・監査レポート（透明性のため公開のまま） |
| `c/<id>/index.html` | AIの回答から人が飛んでくるページ（JSON-LD 付き） |

### カテゴリ

`tool/categories.mjs` に、検索語・除外ルール・スペック抽出パターン・**選び方ガイド**を定義しています。
現在: モバイルバッテリー / USB-C充電器 / 完全ワイヤレスイヤホン / 電気ケトル / 加湿器 / 電動歯ブラシ。
追加はオブジェクトを1つ足すだけです（テストと監査がパターンの妥当性を見ます）。

## 3.5 機能一覧

同じ仕組み（毎日の取得 → 価格履歴 → 判定 → ページ / JSON / MCP / 計測、5言語）の上に、次の機能が載っている。

| 機能 | 内容 | 出力 | 言語 |
| --- | --- | --- | --- |
| カテゴリ比較（21カテゴリ） | 家電・日用品・消耗品の選び方、ランキング、価格判定 | `c/<id>/`, `c/<id>.md`, `api/v1/c/<id>.json` | 5言語 |
| **単価ランキング** | 米・水・トイレットペーパー・電池・コーヒー豆・プロテイン・替えブラシを 1kg/1L/100m/1本あたりで比較。商品名の「5kg×2袋」「2L×9本」「12ロール 50m ダブル」などから総量を計算し、あいまいなものは除外 | 各カテゴリの単価表、`picks.per_unit`、MCP `recommend(sort: unit_price)` | 5言語 |
| **Yahoo!ショッピング併用** | 楽天と同じ商品を店をまたいで統合し、安い方を「Yahoo!ショッピングなら¥X」と併記 | `other_offers`, `cheapest_offer` | 5言語 |
| **セール真偽チェック** | 商品名の「◯%OFF」「半額」を、その商品自身の価格履歴と照合（本当に安い／表示ほどでない／いつも通り／クーポン／未検証）。5と0のつく日・5のつく日・スーパーSALE等も表示 | `sale/`, `api/v1/sale.json`, MCP `sale_check` | 5言語 |
| **お得情報フィード** | いつもより安い商品の Atom フィード（全体・カテゴリ別）。独自ドメイン版では `/feed/watch.xml?ids=…&below=…` で個人用の値下がり監視フィード（登録不要・個人情報なし） | `deals.xml`, `c/<id>/feed.xml` | 5言語 |
| **替えブラシ互換チェッカー** | 型番・商品名から使える純正替えブラシを判定。メーカーが明記したルールだけを出典つきで使い、該当しないものは判定しない | `compat/`, `api/v1/compat.json`, MCP `check_compatibility` | 5言語 |
| **ふるさと納税の実質お得度** | 米・トイレットペーパー・牛肉を「寄附1万円あたりの量」で比較。控除の仕組みと注意点つき | `c/furusato-*/` | 日本語のみ |
| **ホテル料金の買い時** | 7エリア×今後4週の金・土曜について、楽天トラベルの最安料金の水準を毎日記録し、値上がり中／値下がり中を判定 | `hotels/`, `hotels.md`, `api/v1/hotels.json`, MCP `hotel_outlook` | 5言語 |
| **新刊発売日カレンダー** | 人気漫画シリーズの発売予定を楽天ブックスから取得。カレンダー購読（iCalendar）とフィード | `books/`, `books.ics`, `books.xml`, MCP `upcoming_releases` | 日本語のみ |

設定ファイル:
- カテゴリ: `tool/categories.mjs`（`unitPrice` で単価比較、`langs` で言語を限定、`sources` で取得元を限定）
- セールの日付（告知されたら追加）: `tool/sale.mjs` の `MANUAL_EVENTS`
- ホテルのエリア: `tool/hotels.mjs` の `AREAS`（駅の座標と半径）
- 新刊を追うシリーズ: `tool/books.mjs` の `SERIES`
- 互換ルール: `tool/compat.mjs` の `COMPAT_RULES`（メーカーの記載と出典URLが必須）

## 4. 稼働させる手順（初回のみ・人手が必要な部分）

1. **楽天ウェブサービス**でアプリを登録し、**アプリID**と**アクセスキー**を取得。
   「許可するWebサイト」に `bufeks.github.io` を登録（2026年の新APIは Referer/Origin を照合します）。
2. **楽天アフィリエイト**のアフィリエイトIDを確認。
3. （任意・推奨）**Yahoo!デベロッパーネットワーク**でアプリを登録して Client ID を取得し、**バリューコマース**で Yahoo!ショッピングのアフィリエイト（リンク用の参照URL）を用意する。
4. GitHub → Settings → Secrets and variables → Actions に登録:
   - Secrets: `RAKUTEN_APP_ID`, `RAKUTEN_ACCESS_KEY`, `RAKUTEN_AFFILIATE_ID`（楽天市場・楽天トラベル・楽天ブックスに共通）
   - Secrets（Yahoo!を使う場合）: `YAHOO_APP_ID`, `YAHOO_VC_AFFILIATE_ID`（バリューコマースの参照URL。末尾が `&vc_url=` のもの）
   - Variables（任意）: `RAKUTEN_REFERER`（既定 `https://bufeks.github.io/`）, `SHELF_BASE_URL`（独自ドメインにした場合）
5. Actions → **SHELF update** → Run workflow。以後は毎日自動。

これで実データに切り替わり（サンプルの履歴は自動で破棄）、価格判定は7日後から、「値下がり中」ピックはその後に出始めます。

## 5. 自動運用と改善ループ

毎日の実行ごとに `check.mjs` が監査し、結果を Actions のサマリーと `data/report.json` に残します。

- **エラー（ジョブ失敗→Issue自動作成。価格履歴を失わないようデータのコミットとデプロイは行う）**: データ欠落、https でないリンク、開示文なし、実データにサンプル混入、**アフィリエイトリンク率90%未満（=収益ゼロの危険）**
  （Yahoo!のキーだけ入れてバリューコマースのIDを入れていない場合も、この条件でエラーになる）
- **警告（改善の種）**: スペック抽出率50%未満（→正規表現を直す）、除外率75%超（→検索語/NG語を見直す）、3日以上更新なし、異常安値、ランク入り5件未満、選び方ガイドが6か月以上前（→事実を見直す）

APIが落ちたカテゴリは前回データを保持し、3日を超えると `status: stale` として出力に明示します。

## 6. AIに見つけてもらう（配布）

- `llms.txt`・`sitemap.xml`・Markdown 代替リンク（`<link rel="alternate" type="text/markdown">`）は自動生成済み。
- MCP: `claude mcp add shelf -- node /path/to/server.mjs`。公式 MCP Registry やディレクトリへの登録で露出が増える。
- ChatGPT: GPTs を作り、Actions に `openapi.json` を読み込ませる。
- 独自ドメイン（§8）に移ると、`robots.txt` / `llms.txt` がドメイン直下で効き、リモートMCPのURLを登録するだけで使ってもらえる。

## 7. 多言語（日本語・英語・简体中文・繁體中文・한국어）

AIエージェントは利用者の言語で答えるので、選び方ガイドから画面の文言まで各言語で出す。
日本語は今のURLのまま、他の言語は `/<言語>/` と `/api/v1/<言語>/` に置く（`en`, `zh-hans`, `zh-hant`, `ko`）。

- **翻訳するもの**: 選び方ガイド、スペック名と値、価格判定、ピックの理由、ランキングの説明、開示文、llms.txt。
  翻訳は `tool/i18n/<言語>.mjs`。商品名は楽天の原文（日本語）のまま（型番を崩さないため）。
- **海外の利用者向けの注記**（日本語以外）: 価格は日本円・税込み、楽天の多くの店は国内発送のみ（海外なら国際発送の店か転送サービス）、
  メーカー保証は日本国内限定が多い。カテゴリごとに「日本国外での使用」も書く
  （例: ケトル・加湿器は100V専用で、220〜240Vでは使えない。USB-C充電器は多くが100〜240V対応）。
- **ページ**: `<html lang>`、`hreflang`（x-default は英語）、言語切り替えリンク。AI向け利用方法ページは日本語と英語。
- **MCP**: 全ツールに `lang`（ja / en / zh-Hans / zh-Hant / ko、`zh-TW` なども可）。省略時は入力から判定
  （ハングル→韓国語、かな・漢字→日本語、英字→英語）。カテゴリ名はどの言語でも通じる（「가습기」「humidifier」「加湿器」）。
- **計測**: `/go/` のリンクに言語が付き、毎日のトラフィック集計に「言語別クリック数」が出る。
- **品質**: テストが「全言語が英語と同じ文言キー・全カテゴリ・全項目を持っているか」を確認する。
  カテゴリを追加して訳がまだない場合は英語で表示され、監査が警告を出す。

言語を増やすときは `tool/i18n/en.mjs` をコピーして訳し、`tool/i18n/index.mjs` の `LOCALES` に足す。

## 8. 独自ドメイン＋Cloudflare で公開する

GitHub Pages は規約上、商取引が主目的のサイトの無料ホスティングには使えず、下の階層では `llms.txt` / `robots.txt` も効きにくい。
そのため本番は **独自ドメイン＋Cloudflare Workers**（静的ファイル＋小さな Worker、無料枠で足りる）にする。
データ生成は今の GitHub Actions のまま、出力先が増えるだけ。

Worker（`worker/index.mjs`）が静的サイトに足すもの:

| パス | 役割 |
| --- | --- |
| `POST /mcp` | **リモートMCP**（Streamable HTTP）。`claude mcp add --transport http shelf https://<domain>/mcp` のようにURLを登録するだけで使える |
| `/go/<カテゴリ>/<商品ID>` | 購入リンクのクリックを数えて楽天へ302転送。転送先は公開データから引くので任意URLには飛ばない |
| `/c/<id>/` + `Accept: text/markdown` | Markdown を返す（AIエージェント向け） |
| 全リクエスト | AIクローラー（GPTBot, ClaudeBot, PerplexityBot など）の訪問と、ChatGPT・Perplexity・Claude などから来た人を記録 |

記録は Workers Analytics Engine（データセット `shelf_events`）に入り、毎日の更新ジョブが直近7日を集計して
Actions のサマリーに出す（「クリック数」「どのAI経由か」「どのカテゴリがクロールされているのに売れていないか」など）。
数値はリポジトリにはコミットしない。

### 切り替え手順（人手が必要な部分）

1. ドメインを取得し、Cloudflare に追加する（ネームサーバーを Cloudflare に向ける）。
2. Cloudflare で API トークンを作る。権限: **Workers Scripts: Edit**、**Workers Routes: Edit**（対象ゾーン）、**DNS: Edit**（対象ゾーン）、**Account Analytics: Read**。
3. GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `SHELF_BASE_URL` = `https://<ドメイン>`（ドメイン直下。例 `https://shelf.example.com`）
4. Actions → **SHELF deploy (Cloudflare)** → Run workflow。デプロイ後に `llms.txt` と `/mcp` の応答を自動確認する。

`SHELF_BASE_URL` を設定すると、GitHub Pages 側のページの canonical も新ドメインを指すようになる。

## 9. ローカルで動かす

```sh
node shelf/tool/update.mjs          # キーがなければサンプルデータで取得+ビルド
                                    # （実データ運用中はキー無しだと停止。上書きは --force-sample）
node shelf/tool/build.mjs           # data/ から再生成だけ
node shelf/tool/check.mjs           # 監査
node --test 'shelf/tool/test/*.test.mjs'
SHELF_LOCAL_DIR=shelf/api/v1 node shelf/mcp/server.mjs   # MCPをローカルデータで

# Cloudflare 版をローカルで（wrangler が必要）
SHELF_EDGE=1 SHELF_BASE_URL=https://shelf.example.com SHELF_OUT_DIR=/tmp/shelf-edge node shelf/tool/build.mjs
SHELF_OUT_DIR=/tmp/shelf-edge SHELF_BASE_URL=https://shelf.example.com node shelf/tool/edge.mjs
npx wrangler dev --config wrangler.gen.json
```

## 10. 次の打ち手

- カテゴリ拡充（監査の警告が少ないものから）。
- 利用が増えたら、高頻度更新・全価格履歴を x402 等のエージェント向け従量課金APIとして提供（Worker に追加できる）。
- リモートMCPを公式 MCP Registry に登録する。

## 注意

- Yahoo!ショッピングのデータを表示するページには「Webサービス by Yahoo! JAPAN」のクレジット表示が必要（フッターに表示済み）。APIは1分30回程度までに抑えている。
- 報酬率の目安: 楽天市場の家電2%前後（ショップにより上乗せあり）、楽天トラベル国内宿泊1%、楽天ブックス（本）3%、Yahoo!ショッピングはバリューコマース経由の料率。
- ふるさと納税のページは税額控除の仕組みの一般的な説明で、個別の控除額を保証しない（総務省のページと計算ツールへの確認を促している）。

- 楽天API利用規約に従い「Supported by Rakuten Developers」を表示しています。価格履歴の保存・再配布、APIを通じた第三者エージェントへのリンク提供が規約・アフィリエイト規約上問題ないかは、運用者が最新の規約で確認してください。
- 選び方ガイドの事実（PSE、航空機の持ち込み条件など）は変わることがあります。定期的に見直してください。
