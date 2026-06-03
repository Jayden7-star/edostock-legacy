/**
 * 表示用の DateTime 正規化ヘルパー。
 *
 * API から受け取る created_at / updated_at 等は通常 ISO 文字列だが、
 * 過去に混入した素の日時文字列 ("2026-04-11 23:44:48") や数値(ms) が混ざる可能性に備え、
 * 日付表示では `new Date(x)` の代わりにこの関数を使う（安全側）。
 *
 * - number: Unixエポックミリ秒として Date 化。
 * - Date: そのまま。
 * - string: ISO8601 はそのまま、SQLite 形式の素の日時 ("YYYY-MM-DD HH:MM:SS"、TZ無し) は
 *   UTC とみなして解釈する。
 */
export function parseTimestamp(value: number | string | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);

  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = `${s.replace(" ", "T")}Z`;
  }
  return new Date(s);
}
