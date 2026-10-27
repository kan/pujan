# 環境の作成とデプロイ

プチ麻雀の Worker は、API と画面（Static Assets）を 1 つで配る。環境は `backend/wrangler.jsonc` の `env` にある。

| 環境 | ホスト | Worker | D1 | ID 基盤（kan/game） |
|---|---|---|---|---|
| 開発 | `pujan-dev.kan-game.app` | `pujan-dev` | `pujan-dev` | `kan-game-dev`（`dev.kan-game.app`） |
| 本番 | `pujan.kan-game.app` | `pujan` | `pujan-prod` | `kan-game`（`kan-game.app`） |

**リモートのリソースの作成、マイグレーションの適用、デプロイは、利用者の承認を得てから行う**（AGENTS.md「リモートの操作」）。

## 前提

- Cloudflare のアカウントは vegtab・TAKO-SEN と同じ。Workers の有料プランが要る。終わったランの操作ログの再生に、1 ランで 200ms ほどの CPU 時間を使うため（無料プランの上限は 10ms。docs/SPEC.md §5.3）
- `kan-game.app` のゾーンが同じアカウントにある（Custom Domain を付けるため）
- secret は使わない。ID の Cookie の検証に使う公開鍵は `wrangler.jsonc` の `ID_PUBLIC_KEYS` にあり、kan/game の同じ環境の値と一致させる

## 初めて環境を作るとき（開発を例に）

### 1. D1 を作る

```bash
cd backend
npx wrangler d1 create pujan-dev
```

出力の `database_id` を、`wrangler.jsonc` の `env.dev.d1_databases[0].database_id`（`REPLACE_WITH_PUJAN_DEV_DATABASE_ID`）に書く。

### 2. 確認してからデプロイする

```bash
npm test                                   # ルートで。engine・frontend・backend
npm run typecheck -w backend
npm run build
cd backend && npx wrangler deploy --env dev --dry-run && cd ..
# 対象（Worker 名・D1・ホスト）と利用者の承認を確かめてから
npm run deploy:dev                         # マイグレーションの適用 → デプロイ
```

`npm run deploy:dev` は `backend` の `db:migrate:dev`（リモートの D1 へのマイグレーションの適用）を先に実行する。

### 3. kan/game 側の変更を依頼する

ID 基盤の変更は、このリポジトリの作業からは行わない（AGENTS.md「kan/game との関係」）。kan/game の `wrangler.jsonc` の `env.dev` に、次の変更を依頼する。プチ麻雀の Worker がデプロイされてから行う（Service Binding の先が存在しないと、kan/game のデプロイが失敗するため）。

- `ALLOWED_ORIGINS` に `https://pujan-dev.kan-game.app` を足す（ID の API を呼べるオリジン）
- `services` に `{ "binding": "GAME_PUJAN", "service": "pujan-dev", "entrypoint": "GameService" }` を足す（退会のときに記録を消す RPC）
- `GAMES` に `GAME_PUJAN` を足す

本番は同じ変更を `env.production` に、`https://pujan.kan-game.app` と `pujan` で行う。

### 4. 公開後の確認

- `https://pujan-dev.kan-game.app/` が開き、`/api/health` が `{"status":"ok"}` を返す
- 画面を開くと ID が発行され（`/api/id/session` が 200）、新しいランがサーバーのシードで始まる（`/api/runs` が 201）
- ランを終えると記録され、ランキングの画面で名前を登録すると自分の記録が載る
- 許可していないオリジンからの `POST /api/runs` が 403、Cookie なしが 401
- 「感想を送る」から送った感想が `npm run stats -w backend -- feedback --env dev` に出て、終わったランが `npm run stats -w backend -- --env dev` の集計に入る
- 共有したときの表示（OGP）: `https://pujan-dev.kan-game.app/og.png` が開く（`og:url`・`og:image` は本番の URL を指す）
- kan/game の変更のあと、ポータル（`https://dev.kan-game.app`）でテスト用の ID を退会すると、その ID の `runs`・`weekly_best`・`profiles`・`progress`・`feedback` が消える

本番も同じ手順で、`pujan-prod`・`env.production`・ルートの `npm run deploy` を使う。

## 感想とプレイの集計を読む

β公開の間（docs/SPEC.md フェーズ 4.5）は、遊んだ人の感想と、記録したランの操作ログを D1 に残す。読むのはリポジトリのスクリプトで、D1 には書き込まない。

```bash
npm run stats -w backend -- --env production            # プレイの集計（雀士・段位ごとのクリア率、負けた場、役、ショップの品）
npm run stats -w backend -- feedback --env production   # 新しい順の感想（既定 30 件。--limit N）
```

`--env` は `local`（既定）・`dev`・`production`。集計はルールの版（engine の `ENGINE_VERSION`）ごとで、既定は今の版、`--version N` で前の版も見られる（記録したときに数えた結果を `runs.stats` に残している）。個人が分かる値は出さない。感想の一覧は ID の全体を出さず、同じ人の感想は ID の先頭 8 文字で見分ける。

## 2 回目以降のデプロイ

```bash
npm test && npm run typecheck -w backend
npm run deploy:dev        # 本番は npm run deploy
```

- マイグレーションを足したときは、デプロイの前に適用される（`db:migrate:*`）。適用済みのマイグレーションは書き換えない
- engine の版（`ENGINE_VERSION`）を上げたデプロイでは、進行中のランの記録は `version_mismatch` で断られる（端末に残った古いランは端末の中だけで終わる）
- kan/game が ID の署名鍵を入れ替えるときは、kan/game docs/ID_DESIGN.md「鍵の管理」に従って、新しい公開鍵の一覧を `ID_PUBLIC_KEYS` へ写してデプロイする
