import type { Prisma, PrismaClient } from "@prisma/client";

export const STOCKTAKE_ADJUSTMENT_TYPE = "STOCKTAKE_ADJUSTMENT";

export class StocktakeInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StocktakeInputError";
    }
}

type StocktakeErrorCode = "NOT_FOUND" | "UNFINISHED" | "NEGATIVE_STOCK" | "PRODUCT_NOT_FOUND";

export class StocktakeServiceError extends Error {
    constructor(
        public code: StocktakeErrorCode,
        message: string,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "StocktakeServiceError";
    }
}

export function parseActualStockInput(actualStock: unknown): number | null {
    if (actualStock === null || actualStock === undefined) return null;

    if (typeof actualStock === "string") {
        const normalized = actualStock.normalize("NFKC").trim();
        if (normalized === "") return null;
        if (!/^-?\d+$/.test(normalized)) {
            throw new StocktakeInputError("実在庫は整数で入力してください");
        }

        const actual = Number(normalized);
        if (!Number.isInteger(actual)) {
            throw new StocktakeInputError("実在庫は整数で入力してください");
        }
        return actual;
    }

    if (typeof actualStock === "number" && Number.isInteger(actualStock)) {
        return actualStock;
    }

    throw new StocktakeInputError("実在庫は整数で入力してください");
}

export function computeAdjustment(actualStock: number, liveCurrentStock: number) {
    return {
        adjustmentQuantity: actualStock - liveCurrentStock,
        newStock: actualStock,
    };
}

export interface CompleteStocktakeResult {
    success: true;
    discrepancyCount: number;
    completedAt: Date | null;
    alreadyCompleted: boolean;
    adjustmentsCreated: number;
}

export async function completeStocktake(
    db: PrismaClient,
    id: number,
    userId: number
): Promise<CompleteStocktakeResult> {
    return db.$transaction(async (tx) => completeStocktakeInTransaction(tx, id, userId));
}

async function completeStocktakeInTransaction(
    tx: Prisma.TransactionClient,
    id: number,
    userId: number
): Promise<CompleteStocktakeResult> {
    const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
            counts: {
                include: {
                    product: { select: { name: true } },
                },
            },
        },
    });

    if (!stocktake) {
        throw new StocktakeServiceError("NOT_FOUND", "棚卸しが見つかりません");
    }

    if (stocktake.status === "COMPLETED") {
        return {
            success: true,
            discrepancyCount: stocktake.discrepancyCount,
            completedAt: stocktake.completedAt,
            alreadyCompleted: true,
            adjustmentsCreated: 0,
        };
    }

    const unfinished = stocktake.counts.filter((count) => count.actualStock === null);
    if (unfinished.length > 0) {
        throw new StocktakeServiceError(
            "UNFINISHED",
            `${unfinished.length}件の商品が未入力です`,
            { unfinishedCount: unfinished.length }
        );
    }

    const negativeItems = stocktake.counts.filter(
        (count) => count.actualStock !== null && count.actualStock < 0
    );
    if (negativeItems.length > 0) {
        const names = negativeItems.map((count) => count.product.name).join(", ");
        throw new StocktakeServiceError(
            "NEGATIVE_STOCK",
            `実在庫がマイナスの商品があります: ${names}`
        );
    }

    let discrepancyCount = 0;
    let adjustmentsCreated = 0;

    for (const count of stocktake.counts) {
        if (count.actualStock === null) continue;

        const liveProduct = await tx.product.findUnique({
            where: { id: count.productId },
            select: { currentStock: true },
        });
        if (!liveProduct) {
            throw new StocktakeServiceError(
                "PRODUCT_NOT_FOUND",
                `商品が見つかりません: ${count.productId}`
            );
        }

        const theoreticalDiscrepancy = count.actualStock - count.theoreticalStock;
        if (theoreticalDiscrepancy !== 0) discrepancyCount++;

        const { adjustmentQuantity, newStock } = computeAdjustment(
            count.actualStock,
            liveProduct.currentStock
        );

        await tx.product.update({
            where: { id: count.productId },
            data: { currentStock: newStock },
        });

        if (adjustmentQuantity !== 0) {
            await tx.inventoryTransaction.create({
                data: {
                    productId: count.productId,
                    type: STOCKTAKE_ADJUSTMENT_TYPE,
                    quantity: adjustmentQuantity,
                    stockAfter: newStock,
                    note: `棚卸し #${id}: ${count.reason !== "NONE" ? count.reason : "差異確認"}`,
                    userId,
                },
            });
            adjustmentsCreated++;
        }
    }

    const completed = await tx.stocktake.update({
        where: { id },
        data: {
            status: "COMPLETED",
            completedAt: new Date(),
            discrepancyCount,
        },
    });

    return {
        success: true,
        discrepancyCount,
        completedAt: completed.completedAt,
        alreadyCompleted: false,
        adjustmentsCreated,
    };
}
