// @vitest-environment node
//
// 売上CSV P0修正の再発防止テスト（最小範囲）。
// DB接続/実DB/migration/外部API/router副作用なし。
// csv-validation.ts は prisma/express/index.ts に依存しない純粋関数のみのため、
// vi.mock を使わずそのまま import できる。
import { describe, it, expect } from "vitest";
import {
  findMissingProductSalesColumns,
  hasValidSalesLine,
} from "../../server/csv-validation";

describe("findMissingProductSalesColumns", () => {
  it("UTF-8 BOM付きCSV相当のレコードで必須列を認識する（欠落なし）", () => {
    const records = [
      {
        商品コード: "4970974816692",
        商品名: "昆布",
        数量: "1",
        値引き後計: "500",
        部門名: "食品",
      },
    ];
    expect(findMissingProductSalesColumns(records)).toEqual([]);

    // 先頭列名にBOM(U+FEFF)が残ったケースも正規化して認識する
    const bom = String.fromCharCode(0xfeff);
    const withBom = [
      {
        [bom + "商品コード"]: "4970974816692",
        商品名: "昆布",
        数量: "1",
        値引き後計: "500",
        部門名: "食品",
      },
    ];
    expect(findMissingProductSalesColumns(withBom)).toEqual([]);
  });

  it("文字化けヘッダ（必須列に一致しない）を拒否する", () => {
    // Shift_JISで誤読したUTF-8ヘッダ相当の文字化けキー
    const garbled = [{ "ã‚³ãƒ¼ãƒ‰": "x", "åå‰": "y", "æ•°é‡": "1" }];
    expect(findMissingProductSalesColumns(garbled).length).toBeGreaterThan(0);
  });

  it("必須列が一部欠落しているCSVを拒否する", () => {
    const missingQty = [
      { 商品コード: "x", 商品名: "y", 値引き後計: "1", 部門名: "z" },
    ];
    expect(findMissingProductSalesColumns(missingQty)).toContain("数量");
  });

  it("空配列・非配列・非オブジェクトは全列欠落扱い（型安全に拒否）", () => {
    expect(findMissingProductSalesColumns([])).toContain("商品コード");
    expect(findMissingProductSalesColumns(null).length).toBeGreaterThan(0);
    expect(findMissingProductSalesColumns(undefined).length).toBeGreaterThan(0);
    expect(findMissingProductSalesColumns("not-an-array").length).toBeGreaterThan(0);
    expect(findMissingProductSalesColumns([null]).length).toBeGreaterThan(0);
  });
});

describe("hasValidSalesLine", () => {
  it("有効な売上明細が0件なら false（成功扱いにしない）", () => {
    expect(hasValidSalesLine([])).toBe(false);

    // 合計行 / 商品コード空欄(値引き等) のみ → 有効明細0件
    const onlyTotalsAndBlanks = [
      { 商品コード: "合計", 商品名: "合計", 数量: "9" },
      { 商品コード: "", 商品名: "値引き", 数量: "0" },
      { 商品コード: "   ", 商品名: "空白", 数量: "0" },
    ];
    expect(hasValidSalesLine(onlyTotalsAndBlanks)).toBe(false);
  });

  it("有効な売上明細が1件でもあれば true", () => {
    const records = [
      { 商品コード: "合計", 商品名: "合計", 数量: "9" },
      { 商品コード: "4970974816692", 商品名: "昆布", 数量: "1" },
    ];
    expect(hasValidSalesLine(records)).toBe(true);
  });

  it("非配列・非オブジェクトは false（型安全）", () => {
    expect(hasValidSalesLine(null)).toBe(false);
    expect(hasValidSalesLine("not-an-array")).toBe(false);
    expect(hasValidSalesLine([null, 42, "x"])).toBe(false);
  });
});
