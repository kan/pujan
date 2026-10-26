-- ランの記録（docs/SPEC.md §5.2）。ID は kan-game.app の ID 基盤のもの
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  -- 'daily' | 'free'
  mode TEXT NOT NULL,
  -- デイリーの日付（YYYY-MM-DD、日本時間）。free では NULL
  daily_date TEXT,
  -- 到達した場（0〜3）と、クリアしたか
  wave_reached INTEGER NOT NULL,
  cleared INTEGER NOT NULL,
  -- 全場の合計点
  total_score INTEGER NOT NULL,
  -- 操作ログ（サーバーで再生して検証する）
  actions TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_runs_daily ON runs (daily_date, cleared DESC, total_score DESC);
CREATE INDEX idx_runs_user ON runs (user_id, created_at DESC);
