import { Router } from "express";
import { prisma } from "./index.js";

export const optimalStockRouter = Router();

// 月の日数を取得
function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

// POST /api/optimal-stock/calculate — 適正在庫を計算してDBに保存
optimalStockRouter.post("/calculate", async (req, res) => {
    try {
        const { year, month, safetyFactor = 1.2, productIds } = req.body;

        if (!year || !month || month < 1 || month > 12) {
            return res.status(400).json({ error: "year と month (1-12) は必須です" });
        }

        const sf = Number(safetyFactor);
        if (isNaN(sf) || sf <= 0) {
            return res.status(400).json({ error: "safetyFactor は正の数値で指定してください" });
        }

        // 対象商品を取得
        const whereClause: any = { isActive: true };
        if (productIds && Array.isArray(productIds) && productIds.length > 0) {
            whereClause.id = { in: productIds };
        }
        const products = await prisma.product.findMany({ where: whereClause });

        if (products.length === 0) {
            return res.status(404).json({ error: "対象商品が見つかりません" });
        }

        // 対象月と同じ月の過去売上データを取得（全年度分）
        // periodStart の月が target month と一致するレコードを集計
        const allSalesRecords = await prisma.salesRecord.findMany({
            where: {
                productId: { in: products.map((p) => p.id) },
            },
        });

        // 商品ごとに対象月の過去平均日販を算出
        const days = daysInMonth(year, month);
        const results: Array<{
            productId: number;
            productName: string;
            avgDailySales: number;
            optimalStock: number;
        }> = [];

        await prisma.$transaction(async (tx) => {
            for (const product of products) {
                // 対象月と同じ月のレコードを抽出
                const monthRecords = allSalesRecords.filter((r) => {
                    const rMonth = r.periodStart.getMonth() + 1; // 0-indexed → 1-indexed
                    return r.productId === product.id && rMonth === month;
                });

                let avgDailySales = 0;

                if (monthRecords.length > 0) {
                    // 年ごとにグループ化して各年の合計販売数を計算
                    const yearMap = new Map<number, number>();
                    for (const rec of monthRecords) {
                        const y = rec.periodStart.getFullYear();
                        yearMap.set(y, (yearMap.get(y) || 0) + rec.quantitySold);
                    }

                    // 各年の日販を平均
                    const yearCount = yearMap.size;
                    const totalDailySales = Array.from(yearMap.values()).reduce(
                        (sum, qty) => sum + qty / days,
                        0
                    );
                    avgDailySales = totalDailySales / yearCount;
                }

                const optimal = Math.ceil(avgDailySales * days * sf);

                await tx.monthlyOptimalStock.upsert({
                    where: {
                        productId_year_month: {
                            productId: product.id,
                            year,
                            month,
                        },
                    },
                    update: {
                        avgDailySales,
                        safetyFactor: sf,
                        optimalStock: optimal,
                        calculatedAt: new Date(),
                    },
                    create: {
                        productId: product.id,
                        year,
                        month,
                        avgDailySales,
                        safetyFactor: sf,
                        optimalStock: optimal,
                        calculatedAt: new Date(),
                    },
                });

                results.push({
                    productId: product.id,
                    productName: product.name,
                    avgDailySales: Math.round(avgDailySales * 100) / 100,
                    optimalStock: optimal,
                });
            }
        }, { timeout: 30000 });

        res.json({
            year,
            month,
            safetyFactor: sf,
            daysInMonth: days,
            calculatedCount: results.length,
            results,
        });
    } catch (error: any) {
        console.error("適正在庫計算エラー:", error);
        res.status(500).json({ error: "適正在庫の計算に失敗しました" });
    }
});

// GET /api/optimal-stock/:productId — 商品別の月別適正在庫を取得
optimalStockRouter.get("/:productId", async (req, res) => {
    try {
        const productId = parseInt(req.params.productId);
        if (isNaN(productId)) {
            return res.status(400).json({ error: "productId が不正です" });
        }

        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, janCode: true },
        });
        if (!product) {
            return res.status(404).json({ error: "商品が見つかりません" });
        }

        const records = await prisma.monthlyOptimalStock.findMany({
            where: { productId },
            orderBy: [{ year: "desc" }, { month: "asc" }],
        });

        res.json({ product, records });
    } catch (error: any) {
        console.error("適正在庫取得エラー:", error);
        res.status(500).json({ error: "適正在庫の取得に失敗しました" });
    }
});

// GET /api/optimal-stock/month/:year/:month — 特定月の全商品適正在庫一覧
optimalStockRouter.get("/month/:year/:month", async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);

        if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
            return res.status(400).json({ error: "year と month (1-12) を正しく指定してください" });
        }

        const records = await prisma.monthlyOptimalStock.findMany({
            where: { year, month },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        janCode: true,
                        currentStock: true,
                        reorderPoint: true,
                        categoryId: true,
                        category: { select: { name: true, department: true } },
                    },
                },
            },
            orderBy: { product: { name: "asc" } },
        });

        // 過不足フラグを付与
        const results = records.map((r) => ({
            ...r,
            stockDifference: r.product.currentStock - r.optimalStock,
            isUnderstocked: r.product.currentStock < r.optimalStock,
        }));

        res.json({
            year,
            month,
            totalProducts: results.length,
            understockedCount: results.filter((r) => r.isUnderstocked).length,
            results,
        });
    } catch (error: any) {
        console.error("月別適正在庫一覧取得エラー:", error);
        res.status(500).json({ error: "月別適正在庫一覧の取得に失敗しました" });
    }
});
