# プチ麻雀（pujan）

手牌を 5 枚（雀頭 2 ＋面子 3）に縮めた麻雀を、ローグライトとして遊ぶ Web ゲーム。白發中の 3 枚で「大三元」と言い張れる、プチ役が売り。

kan-game.app のゲームの 1 つ（本番 `https://pujan.kan-game.app` 予定）。ID・名前・退会は kan-game.app の ID 基盤（kan/game）と共通。

- 仕様: [`docs/SPEC.md`](docs/SPEC.md)
- プロトタイプ（1 ファイルの HTML、ブラウザで開ける）: [`docs/prototype/puchi-mahjong.html`](docs/prototype/puchi-mahjong.html)
- 開発の手順とエージェント向けの約束: [`AGENTS.md`](AGENTS.md)

## 構成

| パッケージ | 技術 | 説明 |
|---|---|---|
| `engine/` | TypeScript | ルールエンジン。役判定・点数・局・ラン・ショップ。純粋関数、フレームワーク非依存 |
| `frontend/` | Vue 3, Pinia | SPA（PWA） |
| `backend/` | Cloudflare Workers, Hono, D1 | API。ランの記録、ランキング、ID 基盤への中継 |

## はじめかた

```bash
npm install
npm test
npm run dev:roji   # roji がない環境では npm run dev:all
```

ローカルの起動には、kan/game を隣（`../game`）に置いて鍵とローカル D1 を用意しておく必要がある（AGENTS.md「ローカル開発の起動」）。
