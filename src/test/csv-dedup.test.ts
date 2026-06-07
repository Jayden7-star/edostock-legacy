// @vitest-environment node
//
// 内容ハッシュ重複検知の純粋関数テスト。
// DB接続/実DB/migration/外部API/router副作用なし。
// csv-dedup.ts の computeContentHash は prisma/express に依存しない純粋関数のため、
// そのまま import できる（csv-validation.test.ts と同じ作法）。
import { describe, it, expect } from "vitest";
import { computeContentHash } from "../../server/csv-dedup";

const row = (jan: string, name: string, qty: number, net: number) => ({
  商品コード: jan,
  商品名: name,
  数量: String(qty),
  値引き後計: String(net),
  部門名: "食品",
});

describe("computeContentHash", () => {
  it("同一内容なら同一ハッシュ（決定的）", () => {
    const a = [row("4900000000011", "昆布", 3, 1500)];
    const b = [row("4900000000011", "昆布", 3, 1500)];
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });

  it("リネーム耐性: ファイル名は records に含まれないため、内容が同じなら同一ハッシュ", () => {
    // ファイル名は records に無い → ハッシュはファイル名に依存しない（リネームしても一致）
    const records = [row("4900000000011", "昆布", 3, 1500)];
    const h1 = computeContentHash(records);
    const h2 = computeContentHash(records.map((r) => ({ ...r }))); // 別オブジェクトだが同内容
    expect(h1).toBe(h2);
  });

  it("キーの並び順が違っても同一ハッシュ", () => {
    const ordered = [{ 商品コード: "x", 商品名: "y", 数量: "1", 値引き後計: "10", 部門名: "食品" }];
    const shuffled = [{ 部門名: "食品", 値引き後計: "10", 数量: "1", 商品名: "y", 商品コード: "x" }];
    expect(computeContentHash(ordered)).toBe(computeContentHash(shuffled));
  });

  it("前後空白・先頭BOMを正規化して同一ハッシュ", () => {
    const bom = String.fromCharCode(0xfeff);
    const plain = [{ 商品コード: "x", 商品名: "y", 数量: "1", 値引き後計: "10", 部門名: "食品" }];
    const noisy = [{ [bom + "商品コード"]: "x ", 商品名: " y", 数量: "1 ", 値引き後計: " 10", 部門名: "食品 " }];
    expect(computeContentHash(plain)).toBe(computeContentHash(noisy));
  });

  it("1セルでも違えば別ハッシュ（別内容を検知）", () => {
    const a = [row("4900000000011", "昆布", 3, 1500)];
    const b = [row("4900000000011", "昆布", 4, 1500)]; // 数量だけ違う
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });

  it("行数が違えば別ハッシュ", () => {
    const a = [row("4900000000011", "昆布", 3, 1500)];
    const b = [row("4900000000011", "昆布", 3, 1500), row("4900000000028", "わかめ", 1, 300)];
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });

  it("空配列・非配列は null（重複チェック対象外）", () => {
    expect(computeContentHash([])).toBeNull();
    expect(computeContentHash(null)).toBeNull();
    expect(computeContentHash(undefined)).toBeNull();
    expect(computeContentHash("not-an-array")).toBeNull();
  });
});
