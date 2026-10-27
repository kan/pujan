-- ランの記録と週ごとのランキング（docs/SPEC.md §5.3・§5.4）。
-- 0001 の runs はデイリーを前提にした叩き台で、リモートには適用していない。ここで作り直す。
-- 時刻は Unix エポックからのミリ秒（kan/game・TAKO-SEN と同じ）。ID は kan-game.app の ID 基盤のもの。
DROP TABLE IF EXISTS runs;

-- サーバーが渡したシードで始めたラン。終わったら操作ログを再生して成績を書く
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  -- 始めたときの engine の版（ENGINE_VERSION）
  engine_version INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  -- 以下は終わるまで NULL
  finished_at INTEGER,
  -- 突破した場の数（0〜4。4 は全場クリア）と、終わった場の点数の合計
  waves_cleared INTEGER,
  total_score INTEGER
);
CREATE INDEX runs_account ON runs (account_id, started_at DESC);

-- 週ごとの各 ID の最高記録。週は日本時間の月曜の日付（YYYY-MM-DD）
CREATE TABLE weekly_best (
  week TEXT NOT NULL,
  account_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  waves_cleared INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (week, account_id)
);
CREATE INDEX weekly_best_rank ON weekly_best (week, waves_cleared DESC, total_score DESC);

-- ランキングに出す名前と、このゲームでの公開への同意（kan/game docs/ID_DESIGN.md「名前」）
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  consented_at INTEGER NOT NULL
);

-- 退会した ID。Cookie は退会後も最長 400 日有効なので、以後の書き込みを断るために残す
CREATE TABLE deleted_accounts (
  account_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
