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

## 4. 稼働させる手順（初回のみ・人手が必要な部分）

1. **楽天ウェブサービス**でアプリを登録し、**アプリID**と**アクセスキー**を取得。
   「許可するWebサイト」に `bufeks.github.io` を登録（2026年の新APIは Referer/Origin を照合します）。
2. **楽天アフィリエイト**のアフィリエイトIDを確認。
3. GitHub → Settings → Secrets and variables → Actions に登録:
   - Secrets: `RAKUTEN_APP_ID`, `RAKUTEN_ACCESS_KEY`, `RAKUTEN_AFFILIATE_ID`
   - Variables（任意）: `RAKUTEN_REFERER`（既定 `https://bufeks.github.io/`）, `SHELF_BASE_URL`（独自ドメインにした場合）
4. Actions → **SHELF update** → Run workflow。以後は毎日自動。

これで実データに切り替わり（サンプルの履歴は自動で破棄）、価格判定は7日後から、「値下がり中」ピックはその後に出始めます。

## 5. 自動運用と改善ループ

毎日の実行ごとに `check.mjs` が監査し、結果を Actions のサマリーと `data/report.json` に残します。

- **エラー（ジョブ失敗→Issue自動作成。価格履歴を失わないようデータのコミットとデプロイは行う）**: データ欠落、https でないリンク、開示文なし、実データにサンプル混入、**アフィリエイトリンク率90%未満（=収益ゼロの危険）**
- **警告（改善の種）**: スペック抽出率50%未満（→正規表現を直す）、除外率75%超（→検索語/NG語を見直す）、3日以上更新なし、異常安値、ランク入り5件未満、選び方ガイドが6か月以上前（→事実を見直す）

APIが落ちたカテゴリは前回データを保持し、3日を超えると `status: stale` として出力に明示します。

## 6. AIに見つけてもらう（配布）

- `llms.txt`・`sitemap.xml`・Markdown 代替リンク（`<link rel="alternate" type="text/markdown">`）は自動生成済み。
- MCP: `claude mcp add shelf -- node /path/to/server.mjs`。公式 MCP Registry やディレクトリへの登録で露出が増える。
- ChatGPT: GPTs を作り、Actions に `openapi.json` を読み込ませる。
- 独自ドメイン（§7）に移ると、`robots.txt` / `llms.txt` がドメイン直下で効き、リモートMCPのURLを登録するだけで使ってもらえる。

## 7. 独自ドメイン＋Cloudflare で公開する

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

## 8. ローカルで動かす

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

## 9. 次の打ち手

- Yahoo!ショッピング（バリューコマース）を2つ目のソースに追加し、JANコードで店横断の最安比較。
- カテゴリ拡充（監査の警告が少ないものから）。
- 利用が増えたら、高頻度更新・全価格履歴を x402 等のエージェント向け従量課金APIとして提供（Worker に追加できる）。
- リモートMCPを公式 MCP Registry に登録する。

## 注意

- 楽天API利用規約に従い「Supported by Rakuten Developers」を表示しています。価格履歴の保存・再配布、APIを通じた第三者エージェントへのリンク提供が規約・アフィリエイト規約上問題ないかは、運用者が最新の規約で確認してください。
- 選び方ガイドの事実（PSE、航空機の持ち込み条件など）は変わることがあります。定期的に見直してください。
