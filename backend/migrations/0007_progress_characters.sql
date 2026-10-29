-- 解禁した雀士（engine の Progress.characters。docs/SPEC.md §4.6）。1 回のランで解禁する雀士を 1 人までにしたので、
-- 条件から求めずに一覧で持つ（JSON の配列）。
-- NULL はこの列を足す前の行で、読むときに engine の withCharacters で今の条件から求める（選べていた雀士はそのまま）
ALTER TABLE progress ADD COLUMN characters TEXT;
