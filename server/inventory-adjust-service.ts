import type { Prisma, PrismaClient } from "@prisma/client";

// 手動在庫調整の transaction type（既存の単品調整 POST /api/inventory・bulk-stock と同一）。
// 棚卸し確定は別の type（STOCKTAKE_ADJUSTMENT）を使うため、責務は type レベルで分離している。
// 本サービスは棚卸し確定ロジック（stocktakes-service）には一切依存しない自己完結モジュール。
export const MANUAL_ADJUSTMENT_TYPE = "ADJUSTMENT";

export class InventoryAdjustInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InventoryAdjustInputError";
    }
}

type InventoryAdjustErrorCode = "PRODUCT_NOT_FOUND";

export class InventoryAdjustServiceError extends Error {
    constructor(
        public code: InventoryAdjustErrorCode,
        message: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "InventoryAdjustServiceError";
    }
}

/**
 * batch 保存用の厳格な実在庫バリデーション。
 * - 0 は有効
 * - 空欄 / null / undefined は無効
 * - 負数は無効
 * - 小数は無効
 * - 数値以外は無効
 * 文字列は NFKC 正規化して全角数字も受け付ける。
 */
export function parseBatchActualStock(value: unknown): number {
    let parsed: number;
    if (typeof value === "number") {
        parsed = value;
    } else if (typeof value === "string") {
        const normalized = value.normalize("NFKC").trim();
        if (normalized === "") {
            throw new InventoryAdjustInputError("実在庫を入力してください");
        }
        if (!/^-?\d+$/.test(normalized)) {
            throw new InventoryAdjustInputError("実在庫は整数で入力してください");
        }
        parsed = Number(normalized);
    } else {
        // null / undefined / boolean / object など
        throw new InventoryAdjustInputError("実在庫を入力してください");
    }
    if (!Number.isInteger(parsed)) {
        throw new InventoryAdjustInputError("実在庫は整数で入力してください");
    }
    if (parsed < 0) {
        throw new InventoryAdjustInputError("実在庫は0以上で入力してください");
    }
    return parsed;
}

// live の currentStock を基準に差分を計算する（フロントの before 値は信頼しない）。
function computeAdjustment(actualStock: number, liveCurrentStock: number) {
    return { adjustmentQuantity: actualStock - liveCurrentStock, newStock: actualStock };
}

export interface BatchAdjustItemInput {
    productId: number | string;
    actualStock: unknown;
    note?: string;
}

interface NormalizedItem {
    productId: number;
    actualStock: number;
    note: string | null;
}

export interface BatchAdjustResult {
    success: true;
    updated: { id: number; currentStock: number }[];
    adjustmentsCreated: number;
}

/**
 * 入力を検証・正規化する。DB アクセス・書き込みより前（トランザクション外）で実行され、
 * 1件でも不正なら例外を投げて何も書き込ませない（fail-all）。
 * - productId が数値整数でなければ拒否
 * - items 内で productId が数値として重複していれば拒否（後勝ち更新・二重 transaction を防ぐ）
 * - actualStock は parseBatchActualStock で厳格検証
 */
function normalizeItems(items: unknown): NormalizedItem[] {
    if (!Array.isArray(items) || items.length === 0) {
        throw new InventoryAdjustInputError("保存対象がありません");
    }

    const seen = new Set<number>();
    return items.map((raw: BatchAdjustItemInput) => {
        const productId = Number(raw?.productId);
        if (!Number.isInteger(productId) || productId <= 0) {
            throw new InventoryAdjustInputError("商品IDが不正です");
        }
        if (seen.has(productId)) {
            throw new InventoryAdjustInputError(`同じ商品が重複しています（商品ID: ${productId}）`);
        }
        seen.add(productId);

        const actualStock = parseBatchActualStock(raw?.actualStock);
        const note = typeof raw?.note === "string" && raw.note.trim() !== "" ? raw.note : null;
        return { productId, actualStock, note };
    });
}

/**
 * 複数商品の実在庫を単一トランザクションでまとめて保存する。
 * - 検証は書き込み前に全件実施し、1件でも不正なら何も書き込まない（fail-all）。
 *   重複 productId はトランザクションに入る前に拒否する。
 * - トランザクション内ではまず対象商品を一括取得して全件存在を確認し、
 *   1件でも欠けていれば書き込み前に中断する（部分成功なし）。
 * - 各商品は保存直前に取得した live の currentStock を基準に
 *   adjustmentQuantity = actualStock - liveCurrentStock を計算する（フロントの before 値は信頼しない）。
 * - Product.currentStock = actualStock、inventory_transactions.stockAfter = actualStock。
 * - adjustmentQuantity !== 0 の場合だけ inventory_transactions を作成する。
 */
export async function batchAdjustInventory(
    db: PrismaClient,
    items: unknown,
    userId: number
): Promise<BatchAdjustResult> {
    const normalized = normalizeItems(items);

    return db.$transaction(async (tx) => batchAdjustInTransaction(tx, normalized, userId));
}

async function batchAdjustInTransaction(
    tx: Prisma.TransactionClient,
    items: NormalizedItem[],
    userId: number
): Promise<BatchAdjustResult> {
    const ids = items.map((item) => item.productId);

    // 書き込み前に対象商品を一括取得し、全件の存在を確認する（fail-all を明確化）
    const liveProducts = await tx.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, currentStock: true },
    });
    const liveStockById = new Map(liveProducts.map((p) => [p.id, p.currentStock]));

    const missing = ids.filter((id) => !liveStockById.has(id));
    if (missing.length > 0) {
        throw new InventoryAdjustServiceError(
            "PRODUCT_NOT_FOUND",
            `商品が見つかりません（商品ID: ${missing.join(", ")}）`,
            { productIds: missing }
        );
    }

    const updated: { id: number; currentStock: number }[] = [];
    let adjustmentsCreated = 0;

    for (const item of items) {
        const liveCurrentStock = liveStockById.get(item.productId) as number;
        const { adjustmentQuantity, newStock } = computeAdjustment(item.actualStock, liveCurrentStock);

        await tx.product.update({
            where: { id: item.productId },
            data: { currentStock: newStock },
        });

        if (adjustmentQuantity !== 0) {
            await tx.inventoryTransaction.create({
                data: {
                    productId: item.productId,
                    type: MANUAL_ADJUSTMENT_TYPE,
                    quantity: adjustmentQuantity,
                    stockAfter: newStock,
                    note: item.note,
                    userId,
                },
            });
            adjustmentsCreated++;
        }

        updated.push({ id: item.productId, currentStock: newStock });
    }

    return { success: true, updated, adjustmentsCreated };
}
