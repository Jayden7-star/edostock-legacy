// 売上CSV(PRODUCT_SALES)の内容ハッシュによる重複検知。
// ファイル名ベースの重複検知（リネームで簡単にすり抜ける）を補強・置換するため、
// パース済み records から「内容そのもの」のハッシュを計算する。
//
// 設計方針:
// - ファイル名は records に含まれないため、リネームしても同一ハッシュになる（リネーム耐性）。
// - キーの順序差・前後空白・先頭BOMに依存しないよう正規化してからハッシュする。
// - 行の順序は保持する（スマレジの同一エクスポートは決定的順序のため誤検知しない）。
// - router/prisma/express への依存を最小化し、ハッシュ計算は純粋関数として単体テスト可能にする
//   （server/csv-validation.ts と同じ作法）。findContentHashDuplicate のみ prisma を引数で受ける。

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// ヘッダ名先頭のBOM(U+FEFF)を除去して trim する。
// csv-validation.ts と同一の正規化。モジュール独立性のためあえて再定義する。
function stripBomAndTrim(key: string): string {
    const withoutBom = key.charCodeAt(0) === 0xfeff ? key.slice(1) : key;
    return withoutBom.trim();
}

// 1レコードを「キー昇順 + 値trim」で正規化した文字列にする。
// キーの並び順やBOM/空白差で別ハッシュにならないようにする。
function normalizeRecord(rec: Record<string, unknown>): string {
    const entries: [string, string][] = [];
    for (const [rawKey, rawVal] of Object.entries(rec)) {
        const key = stripBomAndTrim(rawKey);
        const val = String(rawVal ?? "").trim();
        entries.push([key, val]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    // フィールド区切り()で結合。CSV内に出現しない制御文字を使い、値の衝突を避ける。
    return entries.map(([k, v]) => `${k}${v}`).join("");
}

/**
 * パース済み records から内容ハッシュ(SHA-256 hex)を計算する。
 * - 空/非配列は null（ハッシュ対象なし）。重複チェックは null のときスキップする。
 * - リネーム耐性: ファイル名は records に含まれないため、同一内容なら同一ハッシュ。
 */
export function computeContentHash(records: unknown): string | null {
    if (!Array.isArray(records) || records.length === 0) return null;
    const hash = createHash("sha256");
    for (const rec of records) {
        if (rec && typeof rec === "object") {
            hash.update(normalizeRecord(rec as Record<string, unknown>));
        } else {
            hash.update(String(rec ?? ""));
        }
        hash.update(""); // レコード区切り
    }
    return hash.digest("hex");
}

export interface ContentHashDuplicate {
    id: number;
    filename: string;
    importedAt: Date;
}

/**
 * 同一内容ハッシュの COMPLETED 済みインポートを探す。
 * - contentHash が null（レガシー行や空CSV）のときは検索しない＝重複なし扱い。
 * - route 側はこの戻り値が非nullなら 409 でハードブロックする（このパスでは再取込許可ボタンは出さない）。
 */
export async function findContentHashDuplicate(
    db: PrismaClient,
    params: { contentHash: string | null; csvType: string }
): Promise<ContentHashDuplicate | null> {
    if (!params.contentHash) return null;
    const existing = await db.csvImport.findFirst({
        where: {
            contentHash: params.contentHash,
            csvType: params.csvType,
            status: "COMPLETED",
        },
        select: { id: true, filename: true, importedAt: true },
    });
    return existing;
}
