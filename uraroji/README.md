# Uraroji — 運用システム

> **Uraroji (裏路地)** — *Deep cuts from Japan's back alleys.*
> 日本人の作り手の目で「現地の人しか知らない1本」を英語で届ける Substack ニュースレター。

このフォルダは Uraroji を**毎週、少ない手間で、品質を落とさずに**回すための仕組み一式です。
コードではなく、ブランド・編集・運用・自動化のルールをまとめています。

## 1. 基本の型

| 項目 | 決めたこと |
| --- | --- |
| 軸 | ジャンルは問わず毎号1本（案B）。色は昭和アンダーグラウンド（案A）を強めに：ガロ系漫画、ATG・独立系映画、アングラ演劇、昭和歌謡・フォーク、ポスター・グラフィック |
| 差別化 | ① 地元の人間の文脈 ② **作り手（美大卒の現役クリエイター）の目での分析** ③ 英語で読む・観る方法まで案内 |
| 読者 | 英語圏の「メインストリームの次」を探す漫画・映画好き、クリエイター、日本旅行者 |
| 配信 | **毎週木曜 22:00 JST**（米東部の木曜朝 8〜9時、英国の木曜昼） |
| 無料 | The Deep Cut（週1本、900〜1,300語） |
| 有料（読者500〜1,000人で開始） | Long Read（月1）、Untranslated Files、Field Notes、Visual Breakdowns、Ask a Local。$7/月・$70/年・Founding $150/年 |

## 2. 週次フロー（あなたの作業は週およそ3〜4時間）

```
月 08:52  [自動] 下書きルーティンが起動
           └ 編集カレンダーから次号を選ぶ → 事実を調べる → 英語下書き・SNS文面・日本語要約
           └ Google ドライブ「Uraroji Drafts」に保存 → Gmail で通知
月〜火    [あなた] 下書きを読み、[YOUR TAKE] 欄に自分の体験と作り手の視点を書く（60〜90分）
水        [あなた] アイキャッチを自作 → 公開前チェックリスト → Substack に貼って木曜 22:00 に予約（45分）
木 22:00  [Substack] 配信
金        [あなた] Notes / X / Bluesky / Instagram に告知（下書き済みの文面を使う、15分）
日        [あなた] 数字を指標シートに記録（5分）、月末のみ月次レビュー（30分）
```

詳細は [`ops/weekly.md`](ops/weekly.md)。

## 3. 自動化の範囲と、自動化しないこと

- **自動**：ネタ選び、下調べ、英語の下書き、件名案、SNS 文面、日本語要約、Gmail での通知
- **手動（意図的に残す）**：あなたの声と体験の追加、画像、事実の最終確認、**Substack への投稿と予約**
  - Substack には記事を投稿する公式 API がない（2026年9月時点）。非公式ツールは規約上グレーなので、収益化する本アカウントでは使わない。
  - Uraroji の価値は「あなたの声」。AI の文章をそのまま流さないことが品質のルール。

ルーティンの設定と、指示文そのものは [`automation/draft-routine.md`](automation/draft-routine.md) にあります。

## 4. ファイル構成

| パス | 中身 |
| --- | --- |
| [`brand/about.md`](brand/about.md) | About ページ（英語）、ウェルカムメール、タグライン |
| [`brand/voice.md`](brand/voice.md) | 文体・トーン、英語表記のルール、AI 利用方針、著作権（引用）ルール |
| [`editorial/calendar.md`](editorial/calendar.md) | 創刊から12号の編集カレンダー（**ルーティンはここを読む**） |
| [`editorial/ideas.md`](editorial/ideas.md) | ネタ帳（思いついたらここに追記） |
| [`templates/deep-cut.md`](templates/deep-cut.md) | 毎週号の型 |
| [`templates/long-read.md`](templates/long-read.md) | 月1回の長編の型 |
| [`templates/social.md`](templates/social.md) | Notes・X・Bluesky・Instagram の型 |
| [`ops/setup.md`](ops/setup.md) | 創刊前に一度だけやる Substack 設定 |
| [`ops/weekly.md`](ops/weekly.md) | 週次フローの詳細 |
| [`ops/checklist.md`](ops/checklist.md) | 公開前チェックリスト |
| [`ops/metrics.md`](ops/metrics.md) | 指標、目標、有料化の判断基準、月次レビュー |
| [`automation/draft-routine.md`](automation/draft-routine.md) | 下書きルーティンの設定と指示文 |

## 5. 運用のルール

1. **カレンダーが唯一の予定表。** 号の入れ替えは `editorial/calendar.md` を直すだけ。ルーティンは次回からそれに従う。
2. **ストックを常に2本持つ。** 足りないときは、ルーティンを手動で追加実行する（`automation/draft-routine.md` §3）。
3. **月末に1回だけ振り返る。** 数字を見て、翌月のカレンダーを並べ替える。毎週は悩まない。
4. **確かでない事実は載せない。** 下書きの `[要確認]` が1つでも残っていたら公開しない。
