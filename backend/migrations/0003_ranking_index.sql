-- ランキングの並び（ORDER BY waves_cleared DESC, total_score DESC, finished_at）と同じ順の索引。
-- 上位 100 人を、週の全件を並べ直さずに読めるようにする（backend/src/lib/ranking.ts）
DROP INDEX IF EXISTS weekly_best_rank;
CREATE INDEX weekly_best_rank ON weekly_best (week, waves_cleared DESC, total_score DESC, finished_at);
