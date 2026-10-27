-- 引き継ぎ（docs/SPEC.md §4.6・§5.4）: 雀士・段位・役の解禁。

-- ランの始めの条件（engine の RunStart の JSON。雀士・段位・解禁済みの役）。終わったランのログの条件と比べる。
-- ここより前のランは標準の雀士・初段・解禁なし（ENGINE_VERSION 1 のランで、再生はもうできない）
ALTER TABLE runs ADD COLUMN start TEXT NOT NULL DEFAULT '{"character":"standard","dan":0,"unlockedYaku":[]}';

-- ランキングは段位 → 突破した場の数 → 合計点の順。雀士は区別せず、表示する
ALTER TABLE weekly_best ADD COLUMN dan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weekly_best ADD COLUMN character TEXT NOT NULL DEFAULT 'standard';
DROP INDEX IF EXISTS weekly_best_rank;
CREATE INDEX weekly_best_rank ON weekly_best (week, dan DESC, waves_cleared DESC, total_score DESC, finished_at);

-- ID ごとの解禁の状態（engine の Progress）。サーバーで確かめたランだけで更新する
CREATE TABLE progress (
  account_id TEXT PRIMARY KEY,
  -- 和了ったことのある役の名前（JSON の配列）
  yaku_won TEXT NOT NULL,
  -- 突破した場の数のいちばん多い記録（0〜4）
  best_waves INTEGER NOT NULL,
  -- 全場クリアしたいちばん高い段位（-1 はまだ）
  dan_cleared INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
