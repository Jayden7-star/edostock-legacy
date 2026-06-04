import type { Prisma, PrismaClient } from "@prisma/client";

// 手動入庫（仕入による現在庫への加算）の transaction type。
// 既存の POST /api/inventory（type 既定値）と同一の "PURCHASE" を再利用する。
// type は Prisma の String カラムであり enum ではないため、新規 type 追加・migration は不要。
// 棚卸し確定（STOCKTAKE_ADJUSTMENT）・直接変更（ADJUSTMENT）・smaregi 同期（SMAREGI_SYNC）とは
// type レベルで責務分離されており、本サービスはそれらのロジックに一切依存しない自己完結モジュール。
export const STOCK_IN_TYPE = "PURCHASE";

export class StockInInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StockInInputError";
    }
}

type StockInErrorCode = "PRODUCT_NOT_FOUND";

export class StockInServiceError extends Error {
    constructor(
        public code: StockInErrorCode,
        message: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "StockInServiceError";
    }
}

/**
 * 入庫数の厳格バリデーション。
 * 現在庫への「加算量」なので 0 や負数は無意味であり、直接変更（parseBatchActualStock: 0 許可）
 * とは異なり 正の整数（1以上）のみ許可する。
 * - 1以上の整数は有効
 * - 空欄 / null / undefined は無効
 * - 0 は無効（加算なしは入庫として扱わない）
 * - 負数は無効
 * - 小数は無効
 * - 数値以外（文字列の非数字・NaN・boolean・object など）は無効
 * 文字列は NFKC 正規化して全角数字も受け付ける。
 */
export function parseStockInQuantity(value: unknown): number {
    let parsed: number;
    if (typeof value === "number") {
        parsed = value;
    } else if (typeof value === "string") {
        const normalized = value.normalize("NFKC").trim();
        if (normalized === "") {
            throw new StockInInputError("入庫数を入力してください");
        }
        if (!/^-?\d+$/.test(normalized)) {
            throw new StockInInputError("入庫数は整数で入力してください");
        }
        parsed = Number(normalized);
    } else {
        // null / undefined / boolean / object / NaN(number以外) など
        throw new StockInInputError("入庫数を入力してください");
    }
    if (!Number.isInteger(parsed)) {
        // NaN・小数はここで弾く
        throw new StockInInputError("入庫数は整数で入力してください");
    }
    if (parsed < 1) {
        throw new StockInInputError("入庫数は1以上の整数で入力してください");
    }
    return parsed;
}

export interface StockInInput {
    productId: number | string;
    quantity: unknown;
    note?: string;
}

export interface StockInResult {
    success: true;
    productId: number;
    quantity: number;
    newStock: number;
}

/**
 * 1商品の入庫（現在庫への加算）を単一トランザクションで処理する。
 * - 入力検証は書き込み前に実施し、不正なら何も書き込まない。
 * - 保存直前に取得した live の currentStock を基準に newStock = currentStock + quantity を計算する
 *   （フロントの before 値は信頼しない）。
 * - Product.currentStock = newStock に更新し、inventory_transactions に必ず監査ログを残す
 *   （type=PURCHASE / quantity=+入庫数 / stockAfter=newStock）。
 */
export async function recordStockIn(
    db: PrismaClient,
    input: StockInInput,
    userId: number
): Promise<StockInResult> {
    const productId = Number(input?.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
        throw new StockInInputError("商品IDが不正です");
    }
    const quantity = parseStockInQuantity(input?.quantity);
    const note =
        typeof input?.note === "string" && input.note.trim() !== "" ? input.note : null;

    return db.$transaction(async (tx) => recordStockInTransaction(tx, productId, quantity, note, userId));
}

async function recordStockInTransaction(
    tx: Prisma.TransactionClient,
    productId: number,
    quantity: number,
    note: string | null,
    userId: number
): Promise<StockInResult> {
    const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, currentStock: true },
    });
    if (!product) {
        throw new StockInServiceError(
            "PRODUCT_NOT_FOUND",
            `商品が見つかりません（商品ID: ${productId}）`,
            { productId }
        );
    }

    const newStock = product.currentStock + quantity;

    await tx.product.update({
        where: { id: productId },
        data: { currentStock: newStock },
    });

    await tx.inventoryTransaction.create({
        data: {
            productId,
            type: STOCK_IN_TYPE,
            quantity,
            stockAfter: newStock,
            note,
            userId,
        },
    });

    return { success: true, productId, quantity, newStock };
}
