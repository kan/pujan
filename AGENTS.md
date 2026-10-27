# プチ麻雀（pujan）— エージェント向け開発ガイド

プチ麻雀は、手牌を 5 枚（雀頭 2 ＋面子 3）に縮めた麻雀を、Balatro 型のローグライトとして遊ぶ Web ゲーム。kan-game.app のゲームの 1 つで、本番は `https://pujan.kan-game.app`（予定）。

## 仕様の参照

- 仕様の正本は [`docs/SPEC.md`](docs/SPEC.md)。ゲームルール・役・点数・ローグライト（アイテム、ボス、祝儀）・画面・API・データ構造に関わる変更の前に、該当する節を読む
- ルールと数値は、プロトタイプ [`docs/prototype/puchi-mahjong.html`](docs/prototype/puchi-mahjong.html) で遊んで確定したもの。判定や画面の挙動に迷ったらプロトタイプを開いて確かめる（1 ファイルの HTML。ブラウザで直接開ける）
- 仕様をこのファイルに重複して書かない。仕様を変えたら `docs/SPEC.md` を直す
- 要求が仕様と食い違うときは、勝手に方針を変えずに食い違いを指摘する

## 現在の状態

`docs/SPEC.md` §6「開発フェーズ」のフェーズ 4（引き継ぎ: 雀士・段位・役の解禁）まで。dev・production のリモートの環境はまだ作っていない（手順は `docs/DEPLOY.md`）。

- `engine/`: 役判定・点数・局の状態機械・ラン・ショップ・操作ログの再生（`game.ts`）・雀士と段位と解禁（`progression.ts`）・シミュレーション（`sim.ts`）。テストあり（`engine/tests/`。プロトタイプとの突き合わせを含む）
- `frontend/`: プロトタイプから移植した画面と、メニュー・役と遊び方・チュートリアル。途中のランは localStorage の操作ログで再開する。ランキングに載せるランはサーバーにシードをもらって始め、終わったら記録を送る
- `backend/`: kan-game.app の ID 連携、ランの記録（操作ログの再生による検証）、週ごとのランキング、退会の RPC。テストは `backend/test/`（Workers のランタイムで動く）

次に取りかかるのはフェーズ 4.5（β公開とフィードバック）。対戦（フェーズ 5）とやり込み（SPEC §4.7）は、β の感想と集計を見てから決める。リモートの環境の作成とデプロイ（`docs/DEPLOY.md`）は、利用者の判断で行う。

## リポジトリ構成

```
pujan/
├── engine/      # ルールエンジン（純粋 TypeScript、フレームワーク非依存）
├── frontend/    # Vue 3 SPA（PWA）
├── backend/     # Cloudflare Workers API（Hono、D1）
├── scripts/     # dev.mjs（ID 基盤・backend・frontend をまとめて起動）
└── docs/
    ├── SPEC.md          # 仕様書（正本）
    └── prototype/       # 確定版のプロトタイプ
```

## 技術スタック

vegtab（kan/vegtab）と同じ構成にそろえる。特別な理由がない限りこの構成から外れない。

TAKO-SEN（kan/tako-sen）は vegtab より新しく、同じ kan-game.app のゲームとして書き方が新しい。保存・ダイアログ・PWA・ID 連携などの手本を探すときは TAKO-SEN も見て、新しいほうの書き方を優先する（Pinia を使う点など、このファイルや `docs/SPEC.md` が決めていることはそちらに従う）。

- TypeScript（全パッケージ）、npm workspaces、Vitest
- frontend: Vue 3（Composition API）、Pinia、Vite、vite-plugin-pwa
- backend: Cloudflare Workers（Hono）、D1。SPA も同じ Worker の Static Assets で配信する
- 認証: kan-game.app の ID（kan/game）。vegtab の `backend/src/lib/id-*.ts`・`middleware/auth.ts` を手本にする

## エンジンの原則

- `engine/` に Vue・Cloudflare・DOM に依存するコードを入れない。frontend と backend（操作ログの再生による検証）の両方が使う
- 状態は書き換えず、`step()` などが新しい状態を返す。乱数（xorshift32）の状態も状態に含め、同じシードと操作列から必ず同じ結果になるようにする
- アイテムの効果は `items.ts` の `Modifiers` への差分として書き、効く場所（`win.ts`・`score.ts`・`kyoku.ts`）で読む。アイテムを足すたびに本体の分岐を増やさない
- 役・点数・確率を変えたらテストも直す。プロトタイプと結果が変わる変更は、意図したものか利用者に確かめる（`engine/tests/prototype.test.ts` が落ちる）
- 同じ操作ログから違う結果になる変更（役・点数・乱数の使い方・ショップなど）をしたら、`game.ts` の `ENGINE_VERSION` を上げる

## 開発の手順

### 初回

```bash
npm install
```

`package-lock.json` を作ったあとは、削除して作り直さない。npm はその時点のプラットフォーム向けの optional な native binding しか lockfile に残さないため、別の OS で `npm ci` したビルドが失敗する（vegtab の CLAUDE.md と同じ注意）。

backend の型は `npm run cf-typegen -w backend` で `backend/worker-configuration.d.ts` を作ってから確かめる。

### テスト

```bash
npm test                 # 全 workspace
npm test -w engine       # engine だけ
```

### バランスのシミュレーション

```bash
npm run sim -w engine -- deal                 # 配牌 5 枚で形ができる確率
npm run sim -w engine -- target --hold 0      # 目標の形を狙う AI の 12 巡の和了率
npm run sim -w engine -- runs --runs 100      # アイテムごとに、ランでどの場まで進めたか
```

オプションは `engine/scripts/sim.mjs` の先頭にある。`runs` は 1 アイテム 100 ランで数十秒かかる。

### ローカル開発の起動

ID 基盤（kan/game の `wrangler dev`）、backend（`wrangler dev`）、frontend（`vite`）は `scripts/dev.mjs` がまとめて起動する（vegtab・TAKO-SEN と同じ形）。

| コマンド | 用途 |
|---|---|
| `npm run dev:roji` | [roji](https://github.com/kan/roji) を通して起動する。`https://pujan.<roji のドメイン>` で開ける |
| `npm run dev:all` | roji なしで起動する。画面は `http://localhost:5173` |

- roji が使える環境（`command -v roji` が成功し、`roji health` が「正常」）では `npm run dev:roji` を使う。その環境では `npm run dev:all`、`vite` や `wrangler dev` の直接の実行で起動しない（ポートの衝突を避けるため）
- 開く URL は、起動時に出る `roji: https://... -> localhost:<ポート>` の行か `roji routes` で確かめる。決め打ちしない
- kan/game をこのリポジトリの隣（`../game`）に置き、kan/game 側で `npm install`、`npm run generate-key -- --dev-vars`、`npx wrangler d1 migrations apply DB --local` を済ませておく。別の場所なら環境変数 `KAN_GAME_DIR` で指定する
- ローカル D1 のマイグレーション（初回と、足した後）: `npm run db:migrate -w backend`

### kan/game との関係

ID・名前・退会は kan/game と共通。kan/game 側の変更（`ALLOWED_ORIGINS`、ゲームの登録など）が要るときは、このリポジトリの作業から kan/game を編集しない。要る変更をまとめて利用者に依頼する。

### リモートの操作

D1・Worker などリモートのリソースの作成、secret の登録、デプロイは、利用者の承認を得てから行う。手順は `docs/DEPLOY.md`。

### kan/game から写したファイル

`backend/src/lib/id-token.ts`・`id-rpc.ts` と `backend/test/kan-game/` は kan/game のファイルの写し（kan/game docs/ID_DESIGN.md「鍵の管理」）。書き換えない。kan/game 側が変わったら、同じ組をまとめて写し直す。

## 書き方

- コードのコメント、ドキュメント、コミットメッセージは日本語でよい（vegtab と同じ）
- 画面の文言は、プロトタイプの言い回しにそろえる（「和了」「流局」「保留」「祝儀」など）
