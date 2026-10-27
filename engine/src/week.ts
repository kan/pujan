/**
 * ランキングの週（docs/SPEC.md §5.4）。日本時間の月曜 0:00 に切り替わり、その月曜の日付（YYYY-MM-DD）で表す。
 * サーバー（記録とランキング）と画面（週の切り替え）の両方で使う。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** その時刻が属する週 */
export function weekOf(now: number): string {
  const jst = new Date(now + JST_OFFSET_MS);
  // getUTCDay: 日曜 0〜土曜 6。月曜までさかのぼる日数
  const back = (jst.getUTCDay() + 6) % 7;
  return new Date(jst.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD の月曜か（ランキングの週の指定を確かめる） */
export function isWeek(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getUTCDay() === 1;
}

/** 日付（YYYY-MM-DD）を days 日ずらす。週を 1 つ前へは shiftDays(week, -7) */
export function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
