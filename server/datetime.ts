/**
 * DateTime（特に inventory_transactions.created_at）を型混在に強く扱うためのヘルパー。
 *
 * 背景:
 * Prisma + SQLite では DateTime は通常 integer（Unixエポックミリ秒）で保存される。
 * しかし過去に Prisma を介さない raw SQL で日時の「文字列」("2026-04-11 23:44:48") が
 * 一部行に混入し、created_at に integer と text が混在した。SQLite の型順序規則では
 * NULL < 数値 < TEXT < BLOB であり、TEXT が数値より「大きい」と扱われるため、
 * `ORDER BY created_at` が真の時系列を返さず、最新トランザクション判定を誤らせる。
 *
 * 方針（このモジュールが提供するもの）:
 * - 「最新トランザクション」取得は型に依存しない id 基準（{@link LATEST_TX_ORDER_BY}）を使う。
 * - raw SQL で時刻ソート/比較する場合は {@link NORMALIZED_CREATED_AT_MS} を ORDER BY 等に使う
 *   （`ORDER BY created_at` を直接書かない）。
 * - JS 側で created_at を数値（ms）として比較したい場合は {@link toEpochMs} を使う。
 *
 * 注: 既存の混在データは書き換えない。これらは「読み取り側」を型非依存にするための道具。
 */

/**
 * number(ms) | Date | 日時文字列 を Unixエポックミリ秒に正規化する。
 *
 * - number: Prisma/SQLite の created_at はミリ秒で保存されるため、そのまま返す。
 * - Date: getTime()。
 * - string: ISO8601（"...T...Z"）はそのまま、SQLite 形式の素の日時
 *   ("YYYY-MM-DD HH:MM:SS"、TZ無し) は UTC とみなして解釈する
 *   （SQL 側 {@link NORMALIZED_CREATED_AT_MS} の strftime('%s', ...) と整合させるため）。
 *
 * 解釈不能な値は例外を投げる（黙ってズレた値を返さない）。
 */
export function toEpochMs(value: number | string | Date): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new Error("toEpochMs: invalid Date");
    return ms;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`toEpochMs: invalid number ${value}`);
    return value;
  }

  let s = value.trim();
  // "YYYY-MM-DD HH:MM:SS"（SQLite datetime 形式・TZ無し）は UTC とみなして
  // strftime('%s', ...) と同じ基準にそろえる。
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    s = `${s.replace(" ", "T")}Z`;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`toEpochMs: unparseable date string "${value}"`);
  return ms;
}

/**
 * raw / 診断 SQL 用の正規化式。created_at が integer/real ならそのまま（ms）、
 * text なら Unix 秒に変換して ms 化する。型混在しても真の時系列でソートできる。
 *
 * 例: `SELECT id FROM inventory_transactions ORDER BY ${NORMALIZED_CREATED_AT_MS} DESC`
 *
 * 注意: TEXT 値は UTC とみなして strftime('%s', ...) で換算する。過去混入の TEXT 値が
 * naive JST だった場合は最大 ±9h の誤差があり得るが、当該行は限定的（月単位で離れている）。
 */
export const NORMALIZED_CREATED_AT_MS =
  "CASE WHEN typeof(created_at) IN ('integer','real') THEN created_at " +
  "ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000 END";

/**
 * 「最新トランザクション」を取る際の標準 orderBy。
 * created_at の型混在に依存せず、PK（自動採番・挿入順＝時刻順に単調）で並べる。
 *
 * 例: `prisma.inventoryTransaction.findFirst({ where: { productId }, orderBy: LATEST_TX_ORDER_BY })`
 */
export const LATEST_TX_ORDER_BY = { id: "desc" } as const;
