-- プレイの集計（docs/SPEC.md フェーズ 4.5）: 終わったランを記録するときに数えた結果（engine の RunStats の JSON）。
-- 操作ログは今の engine の版でしか再生できないので、数えた結果も残して、版を上げたあとも前の版のランを集計できるようにする
ALTER TABLE runs ADD COLUMN stats TEXT;
