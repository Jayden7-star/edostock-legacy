import { Router } from "express";
import { prisma } from "./index";
import {
    completeStocktake,
    parseActualStockInput,
    StocktakeInputError,
    StocktakeServiceError,
} from "./stocktakes-service";

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

        const actual = parseActualStockInput(actualStock);
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
        if (error instanceof StocktakeInputError) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: error.message || "更新に失敗しました" });
    }
});

// POST /api/stocktakes/:id/complete — 棚卸し確定
stocktakesRouter.post("/:id/complete", async (req, res) => {
    const id = parseInt(req.params.id);
    const userId = (req.session as any).userId;

    try {
        const completed = await completeStocktake(prisma, id, userId);
        res.json({
            success: true,
            discrepancyCount: completed.discrepancyCount,
            completedAt: completed.completedAt,
            alreadyCompleted: completed.alreadyCompleted,
        });
    } catch (error: any) {
        if (error instanceof StocktakeServiceError) {
            if (error.code === "NOT_FOUND") {
                return res.status(404).json({ error: error.message });
            }
            if (error.code === "UNFINISHED") {
                return res.status(400).json({
                    error: error.message,
                    unfinishedCount: error.details?.unfinishedCount,
                });
            }
            if (error.code === "NEGATIVE_STOCK") {
                return res.status(400).json({ error: error.message });
            }
        }

        res.status(500).json({ error: error.message || "棚卸し確定に失敗しました" });
    }
});
