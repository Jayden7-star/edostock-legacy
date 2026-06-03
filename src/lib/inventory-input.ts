// 実在庫入力の検証（フロント用）。
// バックエンドの parseBatchActualStock と同じ規則: 0=有効 / 空欄・負数・小数・非数字=無効。
// 全角数字も NFKC 正規化で受け付ける。将来のインライン編集でも同じ関数を使い回せる。
//
// 注: このプロジェクトの tsconfig は strictNullChecks:false のため、判別可能ユニオンの
// 否定分岐の絞り込みが効かない。ok をゲートに value/error を任意プロパティで返す形にしている。
export interface ParseStockResult {
  ok: boolean;
  value?: number;
  error?: string;
}

export function parseActualStockClient(input: unknown): ParseStockResult {
  if (typeof input === "number") {
    if (Number.isInteger(input) && input >= 0) return { ok: true, value: input };
    return { ok: false, error: "実在庫は0以上の整数で入力してください" };
  }
  if (typeof input !== "string") {
    return { ok: false, error: "実在庫を入力してください" };
  }
  const normalized = input.normalize("NFKC").trim();
  if (normalized === "") return { ok: false, error: "実在庫を入力してください" };
  if (!/^-?\d+$/.test(normalized)) return { ok: false, error: "実在庫は整数で入力してください" };
  const value = Number(normalized);
  if (!Number.isInteger(value)) return { ok: false, error: "実在庫は整数で入力してください" };
  if (value < 0) return { ok: false, error: "実在庫は0以上で入力してください" };
  return { ok: true, value };
}
