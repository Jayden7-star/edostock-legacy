import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * 自動登録・要確認商品の「監査台帳」を取得する read-only サービス（未登録JAN/未紐付け対策 Phase 1）。
 *
 * 目的:
 * - 取込(売上CSV・COREC・JANNU)で商品マスタに無いJANに対して自動作成された商品
 *   （`is_auto_created = true`）を、確認済み・未確認を問わず一覧化する。
 * - 発注アラート画面([src/pages/Alerts.tsx])の reviewAlerts は `needs_review = true` のみを表示し、
 *   「確認済みにする」と消える“対応キュー”。本サービスは確認後も残る `is_auto_created = true` を
 *   母集合とする“監査台帳”であり、両者は重複ではなく包含関係。
 *
 * 厳格な read-only:
 * - findMany / count のみを使い、currentStock も inventory_transactions も一切変更しない。
 * - 取込・在庫変動の発生ロジック（csv-sales-service / purchase-import / smaregi / stocktakes 等）には
 *   依存せず、既に products / sales_records / inventory_transactions に永続化された情報を読むだけ。
 *
 * スコープ外（Phase 2）:
 * - Smaregi 同期の未登録JAN無音スキップ([server/smaregi.ts] `if(!product) continue`)、ETOILE 未マッチ、
 *   COREC/JANNU の autoRegister=false スキップ行は DB に痕跡が残らず、本サービスでは扱えない。
 *   これらは将来 import_unknown_rows テーブル新設＋取込時記録で対応する（`skippedRows` は今は常に空）。
 */

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

// 自動作成時に JAN が無い仕入(COREC/JANNU)で採番されるプレースホルダJANの接頭辞。
// 例: "AUTO_1717000000000_abc"（[server/purchase-import.ts] の自動作成 upsert）。
export const PLACEHOLDER_JAN_PREFIX = "AUTO_";

export type ReviewStatusFilter = "all" | "needs_review" | "reviewed";

// 取込元は厳密な sourceImportId ではなく、紐付く sales_records / inventory_transactions からの推定。
// その旨を呼び出し側（API/UI）に必ず伝えるため confidence を固定値で持つ。
export type ImportSourceVia = "SALES_RECORD" | "INVENTORY_TX";

export interface ImportSourceGuess {
    csvImportId: number;
    filename: string;
    csvType: string;
    importedAt: Date;
    via: ImportSourceVia;
    confidence: "inferred";
}

export interface GetAutoCreatedProductsOptions {
    department?: string;
    reviewStatus?: string; // "all" | "needs_review" | "reviewed"（不正値は "all" に正規化）
    placeholderOnly?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface AutoCreatedProductRow {
    id: number;
    janCode: string;
    name: string;
    category: string; // category.displayName
    department: string; // category.department
    currentStock: number;
    reorderPoint: number;
    isAutoCreated: boolean;
    needsReview: boolean;
    isPlaceholderJan: boolean; // janCode が PLACEHOLDER_JAN_PREFIX で始まる
    createdAt: Date;
    importSource: ImportSourceGuess | null; // null = 紐付く取込行が無く推定不能
}

export interface AutoCreatedProductsSummary {
    autoCreatedTotal: number; // is_auto_created=true（+department）の総数
    needsReviewTotal: number; // うち needs_review=true
    reviewedTotal: number; // うち needs_review=false
    placeholderJanTotal: number; // うち janCode が AUTO_ で始まる
}

export interface GetAutoCreatedProductsResult {
    products: AutoCreatedProductRow[];
    total: number; // 全フィルタ適用後の件数（ページング前）
    limit: number;
    offset: number;
    summary: AutoCreatedProductsSummary; // reviewStatus/placeholderOnly/search を除いた母集合内訳
    sourceConfidence: "inferred"; // 取込元が推定であることをレスポンス全体としても明示
    skippedRows: never[]; // Phase 2 用プレースホルダ（痕跡なしスキップ行。MVP は常に空）
}

// limit は [1, MAX_LIMIT]、offset は 0 以上に正規化する。route 側でパース済みでも単体で安全にする。
function normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
    const floored = Math.floor(limit);
    if (floored < 1) return 1;
    if (floored > MAX_LIMIT) return MAX_LIMIT;
    return floored;
}

function normalizeOffset(offset: number | undefined): number {
    if (typeof offset !== "number" || !Number.isFinite(offset)) return 0;
    const floored = Math.floor(offset);
    return floored < 0 ? 0 : floored;
}

function normalizeReviewStatus(value: string | undefined): ReviewStatusFilter {
    return value === "needs_review" || value === "reviewed" ? value : "all";
}

/**
 * ページ上の各商品について「最も古い取込」を推定し、productId → ImportSourceGuess のマップを返す。
 *
 * - sales_records / inventory_transactions の双方を csv_imports.imported_at 昇順で引き、各商品の
 *   最古行を1件ずつ拾う。importedAt は Prisma 管理の integer(ms) で型混在が無いため信頼できる
 *   （inventory_transactions.created_at の型混在問題とは別物。[server/datetime.ts] 参照）。
 * - 売上由来と仕入由来の両方を持つ商品は、importedAt が早い方＝作成元の取込とみなす。
 * - N+1 を避けるため、ページ分の productId をまとめて2クエリ(read-only スナップショット)で取得する。
 */
async function buildImportSourceMap(
    db: PrismaClient,
    productIds: number[]
): Promise<Map<number, ImportSourceGuess>> {
    const result = new Map<number, ImportSourceGuess>();
    if (productIds.length === 0) return result;

    const csvImportSelect = {
        select: { id: true, filename: true, csvType: true, importedAt: true },
    } as const;

    const [salesRecords, transactions] = await db.$transaction([
        db.salesRecord.findMany({
            where: { productId: { in: productIds } },
            orderBy: { csvImport: { importedAt: "asc" } },
            select: { productId: true, csvImport: csvImportSelect },
        }),
        db.inventoryTransaction.findMany({
            where: { productId: { in: productIds }, csvImportId: { not: null } },
            orderBy: { csvImport: { importedAt: "asc" } },
            select: { productId: true, csvImport: csvImportSelect },
        }),
    ]);

    type CsvImportLite = { id: number; filename: string; csvType: string; importedAt: Date };

    // importedAt 昇順で来るので、各 productId で最初に現れたものが最古。
    const oldestSales = new Map<number, CsvImportLite>();
    for (const sr of salesRecords) {
        if (sr.csvImport && !oldestSales.has(sr.productId)) oldestSales.set(sr.productId, sr.csvImport);
    }
    const oldestTx = new Map<number, CsvImportLite>();
    for (const tx of transactions) {
        if (tx.csvImport && !oldestTx.has(tx.productId)) oldestTx.set(tx.productId, tx.csvImport);
    }

    const toGuess = (ci: CsvImportLite, via: ImportSourceVia): ImportSourceGuess => ({
        csvImportId: ci.id,
        filename: ci.filename,
        csvType: ci.csvType,
        importedAt: ci.importedAt,
        via,
        confidence: "inferred",
    });

    for (const productId of productIds) {
        const candidates: ImportSourceGuess[] = [];
        const sales = oldestSales.get(productId);
        const tx = oldestTx.get(productId);
        if (sales) candidates.push(toGuess(sales, "SALES_RECORD"));
        if (tx) candidates.push(toGuess(tx, "INVENTORY_TX"));
        if (candidates.length === 0) continue;
        // importedAt が早い方を採用（同時刻なら SALES_RECORD を優先＝push 順で安定）。
        candidates.sort((a, b) => a.importedAt.getTime() - b.importedAt.getTime());
        result.set(productId, candidates[0]);
    }

    return result;
}

/**
 * 自動登録・要確認商品の監査台帳を id 降順（新しい自動作成が上）で返す。
 *
 * 母集合は `is_auto_created = true`（確認済み含む）。isActive は意図的に絞らない
 * （論理削除された自動作成商品も監査対象として残す）。
 * department / reviewStatus / placeholderOnly / search でフィルタし、limit/offset でページングする。
 * summary は reviewStatus/placeholderOnly/search を除いた母集合（is_auto_created=true + department）の内訳。
 */
export async function getAutoCreatedProducts(
    db: PrismaClient,
    options: GetAutoCreatedProductsOptions = {}
): Promise<GetAutoCreatedProductsResult> {
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const reviewStatus = normalizeReviewStatus(options.reviewStatus);
    const search = typeof options.search === "string" && options.search.trim() !== "" ? options.search.trim() : undefined;
    const department =
        typeof options.department === "string" && options.department.trim() !== "" && options.department !== "ALL"
            ? options.department
            : undefined;

    // 母集合: 自動作成商品（+ department）。summary はこの母集合の内訳を返す。
    const baseWhere: Prisma.ProductWhereInput = {
        isAutoCreated: true,
        ...(department ? { category: { department } } : {}),
    };

    // 一覧用の where は母集合にサブフィルタを重ねる。
    const reviewFilter: Prisma.ProductWhereInput =
        reviewStatus === "needs_review"
            ? { needsReview: true }
            : reviewStatus === "reviewed"
              ? { needsReview: false }
              : {};
    const placeholderFilter: Prisma.ProductWhereInput = options.placeholderOnly
        ? { janCode: { startsWith: PLACEHOLDER_JAN_PREFIX } }
        : {};
    const searchFilter: Prisma.ProductWhereInput = search
        ? { OR: [{ name: { contains: search } }, { janCode: { contains: search } }] }
        : {};

    const where: Prisma.ProductWhereInput = {
        ...baseWhere,
        ...reviewFilter,
        ...placeholderFilter,
        ...searchFilter,
    };

    // ページと件数を同一スナップショットで取得（read-only）。並びは id 降順
    // （created_at は型混在で ORDER BY 不可。[server/datetime.ts] 参照）。
    const [rows, total] = await db.$transaction([
        db.product.findMany({
            where,
            select: {
                id: true,
                janCode: true,
                name: true,
                currentStock: true,
                reorderPoint: true,
                isAutoCreated: true,
                needsReview: true,
                createdAt: true,
                category: { select: { displayName: true, department: true } },
            },
            orderBy: { id: "desc" },
            take: limit,
            skip: offset,
        }),
        db.product.count({ where }),
    ]);

    // summary はサブフィルタ非依存（母集合の内訳）。
    const [autoCreatedTotal, needsReviewTotal, reviewedTotal, placeholderJanTotal] = await db.$transaction([
        db.product.count({ where: baseWhere }),
        db.product.count({ where: { ...baseWhere, needsReview: true } }),
        db.product.count({ where: { ...baseWhere, needsReview: false } }),
        db.product.count({ where: { ...baseWhere, janCode: { startsWith: PLACEHOLDER_JAN_PREFIX } } }),
    ]);

    const sourceMap = await buildImportSourceMap(
        db,
        rows.map((r) => r.id)
    );

    const products: AutoCreatedProductRow[] = rows.map((p) => ({
        id: p.id,
        janCode: p.janCode,
        name: p.name,
        category: p.category.displayName,
        department: p.category.department,
        currentStock: p.currentStock,
        reorderPoint: p.reorderPoint,
        isAutoCreated: p.isAutoCreated,
        needsReview: p.needsReview,
        isPlaceholderJan: p.janCode.startsWith(PLACEHOLDER_JAN_PREFIX),
        createdAt: p.createdAt,
        importSource: sourceMap.get(p.id) ?? null,
    }));

    return {
        products,
        total,
        limit,
        offset,
        summary: { autoCreatedTotal, needsReviewTotal, reviewedTotal, placeholderJanTotal },
        sourceConfidence: "inferred",
        skippedRows: [],
    };
}
