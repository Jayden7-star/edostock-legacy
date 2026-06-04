// 売上CSV(PRODUCT_SALES)のP0バリデーション。
// router/prisma/express に依存しない純粋関数のみ。
// テストから副作用（app.listen/cron）なしで import できるよう、あえて別ファイルに切り出している。

// 売上CSV(PRODUCT_SALES)に必須の列。文字コード不一致/列欠落の検出に使う。
// CLAUDE.md「売上CSV (Smaregi形式)」のキー列と一致させること。
// フロント側(src/pages/CsvImport.tsx)の requiredColumns とも同一に保つこと。
export const PRODUCT_SALES_REQUIRED_COLUMNS = [
    "商品コード",
    "商品名",
    "数量",
    "値引き後計",
    "部門名",
] as const;

export const CSV_COLUMN_ERROR_MESSAGE =
    "CSVの列名を認識できません。スマレジの取引データCSVをUTF-8形式でアップロードしてください。";

export const CSV_NO_SALES_LINE_MESSAGE =
    "有効な売上明細が見つかりませんでした。スマレジの取引データCSV（UTF-8形式）をアップロードしてください。";

// unknown を安全に Record として扱う。オブジェクト以外は null を返す。
function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === "object" && value !== null) {
        return value as Record<string, unknown>;
    }
    return null;
}

// 値を文字列化して前後空白を除去（null/undefined は空文字）。
function normalize(value: unknown): string {
    return String(value ?? "").trim();
}

// ヘッダ名先頭のBOM(U+FEFF)を除去して trim する。
// readAsText(UTF-8) で通常BOMは消えるが、環境差で先頭列名が "﻿商品コード" になる事故に備える。
function stripBomAndTrim(key: string): string {
    const withoutBom = key.charCodeAt(0) === 0xfeff ? key.slice(1) : key;
    return withoutBom.trim();
}

// records(パース済みオブジェクト配列)から必須列のうち欠けているものを返す。
// 先頭BOM/前後空白に強くするためキーを正規化する。空/非配列/非オブジェクトは全列欠落扱い。
export function findMissingProductSalesColumns(records: unknown): string[] {
    if (!Array.isArray(records) || records.length === 0) {
        return [...PRODUCT_SALES_REQUIRED_COLUMNS];
    }
    const first = asRecord(records[0]);
    if (!first) {
        return [...PRODUCT_SALES_REQUIRED_COLUMNS];
    }
    const keys = new Set(Object.keys(first).map(stripBomAndTrim));
    return PRODUCT_SALES_REQUIRED_COLUMNS.filter((c) => !keys.has(c));
}

// 在庫減算対象になりうる「有効な売上明細」が1件でも存在するか。
// 既存ループのスキップ条件(合計行 / 商品コード空欄)と同じ判定を共有する。
// ※「減算が発生したか」ではなく「明細としてパースできたか」で判定するため、
//   棚卸し未実施(currentStock=null)で減算0の正規取込を誤拒否しない。
export function hasValidSalesLine(records: unknown): boolean {
    if (!Array.isArray(records)) return false;
    for (const item of records) {
        const record = asRecord(item);
        if (!record) continue;
        const janCode = normalize(record["商品コード"]);
        const productName = normalize(record["商品名"]);
        if (!janCode || janCode === "合計" || productName === "合計") continue;
        return true;
    }
    return false;
}
