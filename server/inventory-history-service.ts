import type { Prisma, PrismaClient } from "@prisma/client";
import { LATEST_TX_ORDER_BY } from "./datetime.js";

/**
 * 商品単位の在庫変動履歴を取得する read-only サービス。
 *
 * 在庫数や inventory_transactions を一切変更しない（findUnique / findMany / count のみ）。
 * 在庫変動の発生ロジック（売上CSV・入庫・調整・棚卸し・仕入・スマレジ同期）には依存せず、
 * 既に inventory_transactions に永続化された監査証跡を読み出すだけの自己完結モジュール。
 */

// クランプ（マイナス在庫を0に補正）イベントは専用の type やフラグを持たず、note 本文にのみ
// マーカーとして永続化される。SALE_CSV（csv-sales-service.ts）と SMAREGI_SYNC（smaregi.ts）の
// 両方が同じ文字列を書き込む。先頭の絵文字「⚠️」は装飾であり判定には使わず、本文テキストで判定する。
export const CLAMP_NOTE_MARKER = "マイナス在庫を0にクランプ";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

type InventoryHistoryErrorCode = "PRODUCT_NOT_FOUND";

export class ProductNotFoundError extends Error {
    constructor(
        public code: InventoryHistoryErrorCode,
        message: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "ProductNotFoundError";
    }
}

export interface GetProductTransactionsOptions {
    limit?: number;
    offset?: number;
    type?: string;
}

export interface ProductTransactionRow {
    id: number;
    productId: number;
    type: string;
    quantity: number;
    stockAfter: number;
    note: string | null;
    createdAt: Date;
    isClamped: boolean;
    user: { id: number; name: string } | null;
    csvImport: { id: number; filename: string; csvType: string } | null;
}

export interface GetProductTransactionsResult {
    product: { id: number; name: string; janCode: string; currentStock: number };
    transactions: ProductTransactionRow[];
    total: number;
    limit: number;
    offset: number;
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

/**
 * 単一商品の在庫変動履歴を新しい順（id 降順）で返す。
 *
 * - 並び順は必ず {@link LATEST_TX_ORDER_BY}（{ id: "desc" }）を使う。created_at は過去の raw SQL 混入で
 *   integer/text が混在しており、`ORDER BY created_at` は真の時系列を返さない（server/datetime.ts 参照）。
 * - 商品が存在しなければ {@link ProductNotFoundError} を投げる（route 側で 404 にマップ）。
 * - isClamped は note 本文のクランプマーカーから導出する（唯一の永続クランプ信号）。
 */
export async function getProductTransactions(
    db: PrismaClient,
    productId: number,
    options: GetProductTransactionsOptions = {}
): Promise<GetProductTransactionsResult> {
    const product = await db.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, janCode: true, currentStock: true },
    });
    if (!product) {
        throw new ProductNotFoundError("PRODUCT_NOT_FOUND", "商品が見つかりません", { productId });
    }

    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const type =
        typeof options.type === "string" && options.type.trim() !== "" ? options.type : undefined;

    // list と count は同じ where を共有する。type 未指定時は商品全件。
    const where: Prisma.InventoryTransactionWhereInput = { productId, ...(type ? { type } : {}) };

    // 同一スナップショットで件数とページを取得する（read-only トランザクション）。
    // 注: inventory_transactions.product_id にインデックスは無いためフィルタは全件スキャン。
    // 単一店舗の SQLite 規模では問題ないが、履歴が肥大化したら @@index 追加を検討（スキーマ変更）。
    const [rows, total] = await db.$transaction([
        db.inventoryTransaction.findMany({
            where,
            include: {
                user: { select: { id: true, name: true } },
                csvImport: { select: { id: true, filename: true, csvType: true } },
            },
            orderBy: LATEST_TX_ORDER_BY,
            take: limit,
            skip: offset,
        }),
        db.inventoryTransaction.count({ where }),
    ]);

    const transactions: ProductTransactionRow[] = rows.map((t) => ({
        id: t.id,
        productId: t.productId,
        type: t.type,
        quantity: t.quantity,
        stockAfter: t.stockAfter,
        note: t.note,
        createdAt: t.createdAt,
        isClamped: (t.note ?? "").includes(CLAMP_NOTE_MARKER),
        // 参照整合性は SQLite 上で強制されないため、関連が欠けた旧データに備えて防御的に null 許容。
        user: t.user ? { id: t.user.id, name: t.user.name } : null,
        csvImport: t.csvImport
            ? { id: t.csvImport.id, filename: t.csvImport.filename, csvType: t.csvImport.csvType }
            : null,
    }));

    return { product, transactions, total, limit, offset };
}
