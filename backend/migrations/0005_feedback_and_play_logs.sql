-- β公開とフィードバック（docs/SPEC.md フェーズ 4.5）: 感想と、プレイの集計に使う操作ログ。

-- 終わったランの操作ログ（engine の RunLog の JSON）。集計のスクリプトが再生して数える。
-- ここより前に終わったランは NULL（成績だけが残っている）
ALTER TABLE runs ADD COLUMN log TEXT;

-- 遊んだ人の感想。送ったときのランの様子を添える（集計と照らし合わせるため）
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 本文（1,000 字まで）
  body TEXT NOT NULL,
  -- 送ったときのラン（サーバーのランでなければ NULL）と、その雀士・段位・進み具合
  run_id TEXT,
  character TEXT,
  dan INTEGER,
  -- 0〜3（東〜北）。ランが終わっていれば突破した場の数（4 は全場クリア）
  wave INTEGER,
  -- そのランが終わっているか（0/1）
  finished INTEGER,
  score INTEGER,
  engine_version INTEGER,
  app_version TEXT
);
-- 送る頻度の制限（ID ごとの直近の件数）と、新しい順に読むため
CREATE INDEX feedback_account ON feedback (account_id, created_at);
CREATE INDEX feedback_created ON feedback (created_at);
