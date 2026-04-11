import { Router } from "express";
import { prisma } from "./index";

export const stocktakesRouter = Router();

// GET /api/stocktakes — 棚卸し履歴一覧
stocktakesRouter.get("/", async (_req, res) => {
    const stocktakes = await prisma.stocktake.findMany({
        orderBy: { startedAt: "desc" },
        include: { user: { select: { name: true } } },
        take: 20,
    });
    res.json(stocktakes);
});

// POST /api/stocktakes — 棚卸し開始
stocktakesRouter.post("/", async (req, res) => {
    const { stocktakeDate } = req.body;
    const userId = (req.session as any).userId;

    // 進行中の棚卸しがあればエラー
    const inProgress = await prisma.stocktake.findFirst({ where: { status: "IN_PROGRESS" } });
    if (inProgress) {
        return res.status(409).json({ error: "進行中の棚卸しがあります", stocktakeId: inProgress.id });
    }

    const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

    const stocktake = await prisma.stocktake.create({
        data: {
            stocktakeDate: stocktakeDate ? new Date(stocktakeDate) : new Date(),
            userId,
            totalProducts: products.length,
        },
    });

    // 全商品の InventoryCount を生成
    await prisma.inventoryCount.createMany({
        data: products.map((p) => ({
            stocktakeId: stocktake.id,
            productId: p.id,
            theoreticalStock: p.currentStock,
        })),
    });

    res.status(201).json({ id: stocktake.id, totalProducts: products.length });
});

// GET /api/stocktakes/:id — 棚卸し詳細（カウント + 商品情報）
stocktakesRouter.get("/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const stocktake = await prisma.stocktake.findUnique({
        where: { id },
        include: {
            user: { select: { name: true } },
            counts: {
                include: {
                    product: {
                        include: { category: true },
                    },
                },
                orderBy: { product: { name: "asc" } },
            },
        },
    });
    if (!stocktake) return res.status(404).json({ error: "棚卸しが見つかりません" });
    res.json(stocktake);
});

// PUT /api/stocktakes/:id/counts/:productId — 実在庫入力
stocktakesRouter.put("/:id/counts/:productId", async (req, res) => {
    const stocktakeId = parseInt(req.params.id);
    const productId = parseInt(req.params.productId);
    const { actualStock, reason, note } = req.body;

    try {
        const count = await prisma.inventoryCount.findUnique({
            where: { stocktakeId_productId: { stocktakeId, productId } },
        });
        if (!count) return res.status(404).json({ error: "カウント対象が見つかりません" });

        const actual = actualStock !== null && actualStock !== undefined ? parseInt(actualStock) : null;
        const discrepancy = actual !== null ? actual - count.theoreticalStock : null;

        const updated = await prisma.inventoryCount.update({
            where: { stocktakeId_productId: { stocktakeId, productId } },
            data: {
                actualStock: actual,
                discrepancy,
                reason: reason || "NONE",
                note: note || null,
            },
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "更新に失敗しました" });
    }
});

// POST /api/stocktakes/:id/complete — 棚卸し確定
stocktakesRouter.post("/:id/complete", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = (req.session as any).userId;

    const stocktake = await prisma.stocktake.findUnique({
        where: { id },
        include: { counts: { include: { product: true } } },
    });
    if (!stocktake) return res.status(404).json({ error: "棚卸しが見つかりません" });
    if (stocktake.status === "COMPLETED") return res.status(409).json({ error: "既に確定済みです" });

    // 未入力チェック
    const unfinished = stocktake.counts.filter((c) => c.actualStock === null);
    if (unfinished.length > 0) {
        return res.status(400).json({
            error: `${unfinished.length}件の商品が未入力です`,
            unfinishedCount: unfinished.length,
        });
    }

    // マイナス在庫バリデーション
    const negativeItems = stocktake.counts.filter((c) => c.actualStock !== null && c.actualStock < 0);
    if (negativeItems.length > 0) {
        const names = negativeItems.map((c) => c.product.name).join(", ");
        return res.status(400).json({
            error: `実在庫がマイナスの商品があります: ${names}`,
        });
    }

    let discrepancyCount = 0;

    // 各商品の在庫を更新し、差異があればトランザクション記録
    for (const count of stocktake.counts) {
        if (count.actualStock === null) continue;
        const diff = count.actualStock - count.theoreticalStock;

        if (diff !== 0) {
            discrepancyCount++;
            await prisma.$transaction([
                prisma.product.update({
                    where: { id: count.productId },
                    data: { currentStock: count.actualStock },
                }),
                prisma.inventoryTransaction.create({
                    data: {
                        productId: count.productId,
                        type: "STOCKTAKE",
                        quantity: diff,
                        stockAfter: count.actualStock,
                        note: `棚卸し #${id}: ${count.reason !== "NONE" ? count.reason : "差異確認"}`,
                        userId,
                    },
                }),
            ]);
        } else {
            // 差異なしでも currentStock を actualStock に更新（理論在庫の確認）
            await prisma.product.update({
                where: { id: count.productId },
                data: { currentStock: count.actualStock },
            });
        }
    }

    // 棚卸しを完了に更新
    const completed = await prisma.stocktake.update({
        where: { id },
        data: {
            status: "COMPLETED",
            completedAt: new Date(),
            discrepancyCount,
        },
    });

    res.json({ success: true, discrepancyCount, completedAt: completed.completedAt });
});
