import { Router } from "express";
import { prisma } from "./index.js";

export const optimalStockRouter = Router();

// 月の日数を取得
function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

// カテゴリ別安全係数
function safetyFactorByDepartment(department: string): number {
    switch (department) {
        case "FOOD": return 1.2;    // 賞味期限リスク
        case "APPAREL": return 1.5; // 欠品機会損失
        case "GOODS": return 1.5;
        default: return 1.3;
    }
}

// POST /api/optimal-stock/calculate — 全対象商品 × 全月（1-12）の適正在庫を計算してDB保存
optimalStockRouter.post("/calculate", async (req, res) => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const year = req.body.year || currentYear;

        // ── 0. 終売自動判定 ──
        // 対象: sales_type が REGULAR の商品のみ
        // 条件: 過去に販売実績があり、直近3ヶ月で販売0
        const threeMonthsAgo = new Date(currentYear, currentMonth - 3, 1);

        const regularProducts = await prisma.product.findMany({
            where: { isActive: true, salesType: "REGULAR" },
            select: { id: true, name: true, janCode: true },
        });

        const discontinuedList: { id: number; name: string; janCode: string }[] = [];

        for (const prod of regularProducts) {
            const pastSales = await prisma.salesRecord.findFirst({
                where: { productId: prod.id, quantitySold: { gt: 0 } },
            });
            if (!pastSales) continue;

            const recentSales = await prisma.salesRecord.findFirst({
                where: {
                    productId: prod.id,
                    periodStart: { gte: threeMonthsAgo },
                    quantitySold: { gt: 0 },
                },
            });
            if (!recentSales) {
                await prisma.product.update({
                    where: { id: prod.id },
                    data: { salesType: "DISCONTINUED" },
                });
                discontinuedList.push(prod);
            }
        }

        // ── 1. 販売実績がある商品を特定（DISCONTINUED除外）──
        const allSalesForActive = await prisma.salesRecord.findMany({
            where: { quantitySold: { gt: 0 } },
            select: { productId: true },
        });
        const activeProductIds = Array.from(
            new Set(allSalesForActive.map((r) => r.productId))
        );

        if (activeProductIds.length === 0) {
            return res.json({
                year,
                message: "販売実績のある商品がありません",
                calculatedCount: 0,
                discontinuedCount: discontinuedList.length,
                discontinuedProducts: discontinuedList,
                results: [],
            });
        }

        // ── 2. 対象商品をカテゴリ付きで取得（DISCONTINUED除外）──
        const products = await prisma.product.findMany({
            where: {
                id: { in: activeProductIds },
                isActive: true,
                salesType: { not: "DISCONTINUED" },
            },
            include: { category: true },
        });

        if (products.length === 0) {
            return res.json({
                year,
                message: "対象のアクティブ商品がありません",
                calculatedCount: 0,
                discontinuedCount: discontinuedList.length,
                discontinuedProducts: discontinuedList,
                results: [],
            });
        }

        // ── 3. 全販売データを取得（quantitySold > 0 で discount 除外）──
        const allSalesRecords = await prisma.salesRecord.findMany({
            where: {
                productId: { in: products.map((p) => p.id) },
                quantitySold: { gt: 0 },
            },
        });

        // ── 4. 各商品 × 各月（1-12）の適正在庫を計算 ──
        type MonthResult = {
            month: number;
            daysInMonth: number;
            yearData: Record<number, number>;
            avgDailySales: number;
            optimalStock: number;
            hasSales: boolean;
        };

        type ProductResult = {
            productId: number;
            productName: string;
            janCode: string;
            department: string;
            salesType: string;
            safetyFactor: number;
            months: MonthResult[];
        };

        const results: ProductResult[] = [];

        await prisma.$transaction(
            async (tx) => {
                for (const product of products) {
                    const department = product.category.department;
                    const sf = safetyFactorByDepartment(department);
                    const productRecords = allSalesRecords.filter(
                        (r) => r.productId === product.id
                    );

                    // 全月のデータを集計
                    const monthYearMap = new Map<number, Map<number, number>>();
                    for (let m = 1; m <= 12; m++) {
                        monthYearMap.set(m, new Map());
                    }
                    for (const rec of productRecords) {
                        const rMonth = rec.periodStart.getMonth() + 1;
                        const y = rec.periodStart.getFullYear();
                        const yearMap = monthYearMap.get(rMonth)!;
                        yearMap.set(y, (yearMap.get(y) || 0) + rec.quantitySold);
                    }

                    const months: MonthResult[] = [];

                    for (let m = 1; m <= 12; m++) {
                        const days = daysInMonth(year, m);
                        const yearMap = monthYearMap.get(m)!;

                        let avgDailySales = 0;
                        const hasSales = yearMap.size > 0;

                        if (hasSales) {
                            const totalMonthlyQty = Array.from(yearMap.values()).reduce(
                                (sum, qty) => sum + qty,
                                0
                            );
                            const avgMonthlyQty = totalMonthlyQty / yearMap.size;
                            avgDailySales = avgMonthlyQty / days;
                        }

                        const optimal = Math.ceil(avgDailySales * days * sf);

                        await tx.monthlyOptimalStock.upsert({
                            where: {
                                productId_year_month: {
                                    productId: product.id,
                                    year,
                                    month: m,
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
                                month: m,
                                avgDailySales,
                                safetyFactor: sf,
                                optimalStock: optimal,
                                calculatedAt: new Date(),
                            },
                        });

                        months.push({
                            month: m,
                            daysInMonth: days,
                            yearData: Object.fromEntries(yearMap),
                            avgDailySales: Math.round(avgDailySales * 100) / 100,
                            optimalStock: optimal,
                            hasSales,
                        });
                    }

                    results.push({
                        productId: product.id,
                        productName: product.name,
                        janCode: product.janCode,
                        department,
                        salesType: product.salesType,
                        safetyFactor: sf,
                        months,
                    });
                }
            },
            { timeout: 60000 }
        );

        res.json({
            year,
            calculatedCount: results.length,
            discontinuedCount: discontinuedList.length,
            discontinuedProducts: discontinuedList,
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
            select: { id: true, name: true, janCode: true, salesType: true },
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
            return res.status(400).json({
                error: "year と month (1-12) を正しく指定してください",
            });
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
                        salesType: true,
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
