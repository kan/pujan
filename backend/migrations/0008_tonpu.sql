-- 東風戦とお題（docs/SPEC.md §4.1・§5.3・§5.4、フェーズ 4.6）。
-- 1 ランを東南西北の 4 場から東風戦（東 1〜4 局）にし、同時に掲げたお題を 1 つ以上果たすとクリアにする。

-- ランの成績: お題と果たしたか（engine の MissionResult の配列の JSON）、クリアしたか（0/1）、
-- 記録点（クリアなら、果たしたお題の倍率の合計を掛けた合計点）。
-- 合計点は total_score を使い続ける。waves_cleared は 4 場の形のランの成績で、東風戦のランでは NULL のまま
ALTER TABLE runs ADD COLUMN missions TEXT;
ALTER TABLE runs ADD COLUMN cleared INTEGER;
ALTER TABLE runs ADD COLUMN record_score INTEGER;
-- 途中経過（POST /api/runs/:id/progress）: 最後に精算した局の数（連荘の本場も 1 局に数える）と、その時刻。
-- 集計でどこでやめたかを見るためだけに使う（再生では確かめない）
ALTER TABLE runs ADD COLUMN last_kyoku INTEGER;
ALTER TABLE runs ADD COLUMN last_kyoku_at INTEGER;

-- ランキングは段位 → クリアしたか → 記録点の順。お題は表示する。
-- 4 場の形の記録は、クリアなし・記録点 0 のままにする（16 局の合計点は東風戦と尺度が違うので比べない。
-- 同じ ID が東風戦で記録すれば置き換わる。docs/SPEC.md §4.6）
ALTER TABLE weekly_best ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weekly_best ADD COLUMN record_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE weekly_best ADD COLUMN missions TEXT;
DROP INDEX IF EXISTS weekly_best_rank;
CREATE INDEX weekly_best_rank ON weekly_best (week, dan DESC, cleared DESC, record_score DESC, finished_at);

-- 解禁の状態: クリアしたお題の倍率のいちばん高い記録（0 はまだ）。
-- best_waves は 4 場の形の記録で、東風戦では増えない（雀士の一覧を持たない前の行を読むときだけ使う）
ALTER TABLE progress ADD COLUMN best_times REAL NOT NULL DEFAULT 0;

-- 感想に添えるランの様子: 終えた局の数（0〜4）、お題と果たしたか（「×1 和了 2 回（済）・×1.5 …」）、
-- クリアしたか（0/1。終わる前は NULL）。wave は 4 場の形のときの値で、東風戦の感想では NULL
ALTER TABLE feedback ADD COLUMN kyoku INTEGER;
ALTER TABLE feedback ADD COLUMN missions TEXT;
ALTER TABLE feedback ADD COLUMN cleared INTEGER;
