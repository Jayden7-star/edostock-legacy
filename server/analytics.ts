import { Router } from "express";
import { prisma } from "./index.js";

export const analyticsRouter = Router();

// GET /api/analytics/dashboard
analyticsRouter.get("/dashboard", async (req, res) => {
    try {
        const department = req.query.department as string | undefined;
        const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
        const allProducts = await prisma.product.findMany({
            where: { isActive: true, ...deptFilter },
            include: { category: true },
        });

        // Alert count
        const alerts = allProducts.filter(
            (p) => p.reorderPoint > 0 && p.currentStock <= p.reorderPoint
        );

        // Total stock
        const totalStock = allProducts.reduce((sum, p) => sum + p.currentStock, 0);

        // Monthly sales
        const now = new Date();
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        const currentMonthSales = await prisma.monthlySales.findFirst({
            where: { month: thisMonth },
        });
        const prevMonthSales = await prisma.monthlySales.findFirst({
            where: { month: prevMonth },
        });

        // Gross margin
        const productsWithCost = allProducts.filter((p) => p.costPrice > 0 && p.sellingPrice > 0);
        let grossMarginRate = 0;
        if (productsWithCost.length > 0) {
            const totalRevenue = productsWithCost.reduce((sum, p) => sum + p.sellingPrice, 0);
            const totalCost = productsWithCost.reduce((sum, p) => sum + p.costPrice, 0);
            grossMarginRate = ((totalRevenue - totalCost) / totalRevenue) * 100;
        }

        // Sales trend
        const monthlySalesData = await prisma.monthlySales.findMany({
            orderBy: { month: "asc" },
            take: 12,
        });
        const salesTrend = monthlySalesData.map((m) => ({
            month: `${new Date(m.month).getMonth() + 1}月`,
            sales: m.netSales,
        }));

        const salesChange = prevMonthSales && prevMonthSales.netSales > 0
            ? ((currentMonthSales?.netSales || 0) - prevMonthSales.netSales) / prevMonthSales.netSales * 100
            : 0;

        // Forecast: next month predicted sales
        const seasonalIndex = await calculateSeasonalIndex();
        const currentMonth = now.getMonth() + 1; // 1-12
        const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
        const nextMonthFactor = seasonalIndex.get(nextMonth) || 1.0;

        // Calculate average monthly sales from available data
        const recentMonths = monthlySalesData.filter((m) => m.netSales > 0);
        const avgMonthlySales = recentMonths.length > 0
            ? recentMonths.reduce((sum, m) => sum + m.netSales, 0) / recentMonths.length
            : 0;
        const forecastNextMonth = Math.round(avgMonthlySales * nextMonthFactor);

        // Seasonal note (only for November and December)
        let seasonalNote: string | null = null;
        if (currentMonth === 11) {
            seasonalNote = "⚠️ 来月は超繁忙期です。在庫の積み増しを推奨します。";
        } else if (currentMonth === 12) {
            seasonalNote = "📈 繁忙期の真っ最中です。在庫切れに注意してください。";
        }

        // 値引き・セット売り集計（discount_records）
        const discountAgg = await prisma.discountRecord.aggregate({
            _sum: { amount: true },
            _count: true,
            where: { recordType: "DISCOUNT" },
        });
        const setItemAgg = await prisma.discountRecord.aggregate({
            _sum: { amount: true },
            _count: true,
            where: { recordType: "SET_ITEM" },
        });

        // Smaregi sync status
        const smaregiConfig = await prisma.smaregiConfig.findFirst();

        res.json({
            alertCount: alerts.length,
            totalStock,
            totalProducts: allProducts.length,
            monthlySales: currentMonthSales?.netSales || 0,
            salesChange: Math.round(salesChange * 10) / 10,
            grossMarginRate: Math.round(grossMarginRate * 10) / 10,
            salesTrend,
            forecastNextMonth,
            seasonalNote,
            discountTotal: discountAgg._sum.amount || 0,
            discountCount: discountAgg._count || 0,
            setItemTotal: setItemAgg._sum.amount || 0,
            setItemCount: setItemAgg._count || 0,
            alertProducts: alerts.slice(0, 10).map((p) => ({
                id: p.id,
                name: p.name,
                currentStock: p.currentStock,
                reorderPoint: p.reorderPoint,
                category: p.category.displayName,
            })),
            lastSyncAt: smaregiConfig?.lastSyncAt || null,
            syncEnabled: smaregiConfig?.syncEnabled || false,
        });
    } catch (error) {
        console.error("Dashboard error:", error);
        res.json({
            alertCount: 0, totalStock: 0, totalProducts: 0,
            monthlySales: 0, salesChange: 0, grossMarginRate: 0,
            salesTrend: [], forecastNextMonth: 0, seasonalNote: null,
            discountTotal: 0, discountCount: 0, setItemTotal: 0, setItemCount: 0,
            alertProducts: [],
            lastSyncAt: null, syncEnabled: false,
        });
    }
});

// GET /api/analytics/abc?period=month
analyticsRouter.get("/abc", async (req, res) => {
    try {
        const period = (req.query.period as string) || "month";
        const department = req.query.department as string | undefined;
        const deptFilter = department && department !== "ALL" ? { product: { category: { department } } } : {};
        const periodDays: Record<string, number> = { week: 7, month: 30, quarter: 90, half: 180, year: 365 };
        const days = periodDays[period] || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        // Aggregate sales by product
        const salesRecords = await prisma.salesRecord.findMany({
            where: { periodStart: { gte: cutoff }, ...deptFilter },
            include: { product: { include: { category: true } } },
        });

        const productSales = new Map<number, { name: string; category: string; sales: number }>();
        for (const r of salesRecords) {
            const existing = productSales.get(r.productId) || {
                name: r.product.name,
                category: r.product.category.displayName,
                sales: 0,
            };
            existing.sales += r.netSales;
            productSales.set(r.productId, existing);
        }

        // Sort by sales descending
        const sorted = Array.from(productSales.entries())
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => b.sales - a.sales);

        const totalSales = sorted.reduce((sum, p) => sum + p.sales, 0);

        // Calculate cumulative percentage and rank
        let cumulative = 0;
        const products = sorted.map((p) => {
            cumulative += p.sales;
            const cumPct = totalSales > 0 ? (cumulative / totalSales) * 100 : 0;
            const rank = cumPct <= 70 ? "A" : cumPct <= 90 ? "B" : "C";
            return { ...p, cumPct: Math.round(cumPct * 10) / 10, rank };
        });

        // Summary
        const summary = {
            A: { count: products.filter((p) => p.rank === "A").length, salesPct: "70%" },
            B: { count: products.filter((p) => p.rank === "B").length, salesPct: "20%" },
            C: { count: products.filter((p) => p.rank === "C").length, salesPct: "10%" },
        };

        const aCount = summary.A.count;
        const insight = totalSales > 0
            ? `Aランク商品はわずか ${aCount}品目 で売上の 70% を占めています。これらの在庫切れを防ぐことが最優先です。`
            : null;

        res.json({ products, summary, insight, totalSales, dataStatus: totalSales > 0 ? "ready" : "insufficient" });
    } catch (error) {
        console.error("ABC analysis error:", error);
        res.json({ products: [], summary: { A: { count: 0, salesPct: "0%" }, B: { count: 0, salesPct: "0%" }, C: { count: 0, salesPct: "0%" } }, insight: null, totalSales: 0, dataStatus: "insufficient" });
    }
});

// GET /api/analytics/seasonal
analyticsRouter.get("/seasonal", async (req, res) => {
    // department param accepted but not applied: MonthlySales is store-level aggregate with no department breakdown
    try {
        const monthlySales = await prisma.monthlySales.findMany({
            orderBy: { month: "asc" },
        });

        if (monthlySales.length === 0) {
            return res.json({ monthlyTrend: [], heatmap: [], insight: null, dataStatus: "insufficient" });
        }

        // Group by year-month
        const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
        const byYearMonth = new Map<string, { year: number; monthIdx: number; sales: number }>();
        for (const m of monthlySales) {
            const d = new Date(m.month);
            const year = d.getFullYear();
            const monthIdx = d.getMonth();
            const key = `${year}-${monthIdx}`;
            byYearMonth.set(key, { year, monthIdx, sales: m.netSales });
        }

        // Find the latest year in data
        const years = Array.from(byYearMonth.values()).map((v) => v.year);
        const latestYear = Math.max(...years);

        // Build monthly trend (fiscal year order: 4月-3月)
        const fiscalOrder = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]; // Apr=3, May=4, ..., Mar=2
        const monthlyTrend = fiscalOrder.map((monthIdx) => {
            const currentKey = `${monthIdx <= 2 ? latestYear : latestYear - 1}-${monthIdx}`;
            const prevKey = `${monthIdx <= 2 ? latestYear - 1 : latestYear - 2}-${monthIdx}`;
            const current = byYearMonth.get(currentKey);
            const prev = byYearMonth.get(prevKey);
            return {
                month: monthNames[monthIdx],
                sales: current?.sales || 0,
                prevYear: prev?.sales || null,
            };
        });

        // Heatmap data (same order, in millions)
        const heatmap = monthlyTrend.map((m) => ({
            month: m.month,
            value: Math.round((m.sales / 1000000) * 10) / 10,
        }));

        // Build insight
        const maxMonth = heatmap.reduce((a, b) => (a.value > b.value ? a : b), heatmap[0]);
        const minMonth = heatmap.reduce((a, b) => (a.value < b.value ? a : b), heatmap[0]);
        const insight = `${maxMonth.month}が最高売上（${maxMonth.value}M円）、${minMonth.month}が最低（${minMonth.value}M円）。繁忙期に向けて在庫積み増しを推奨します。`;

        res.json({ monthlyTrend, heatmap, insight, dataStatus: "ready" });
    } catch (error) {
        console.error("Seasonal analysis error:", error);
        res.json({ monthlyTrend: [], heatmap: [], insight: null, dataStatus: "insufficient" });
    }
});

// === 季節指数の計算（共通ヘルパー）===
async function calculateSeasonalIndex(): Promise<Map<number, number>> {
    const monthlySales = await prisma.monthlySales.findMany({ orderBy: { month: "asc" } });

    if (monthlySales.length < 12) {
        // 江戸一飯田の実態に基づくデフォルト季節指数
        return new Map([
            [1, 0.65], [2, 0.60], [3, 0.85], [4, 0.85],
            [5, 0.90], [6, 0.80], [7, 0.65], [8, 0.60],
            [9, 0.75], [10, 0.85], [11, 0.95], [12, 2.20],
        ]);
    }

    const totalSales = monthlySales.reduce((sum, m) => sum + m.netSales, 0);
    const avgMonthlySales = totalSales / monthlySales.length;

    const monthlyAvg = new Map<number, { total: number; count: number }>();
    for (const m of monthlySales) {
        const month = new Date(m.month).getMonth() + 1;
        const existing = monthlyAvg.get(month) || { total: 0, count: 0 };
        existing.total += m.netSales;
        existing.count++;
        monthlyAvg.set(month, existing);
    }

    const seasonalIndex = new Map<number, number>();
    for (const [month, data] of monthlyAvg) {
        seasonalIndex.set(month, (data.total / data.count) / avgMonthlySales);
    }
    return seasonalIndex;
}

// GET /api/analytics/forecast
analyticsRouter.get("/forecast", async (req, res) => {
    try {
        const department = req.query.department as string | undefined;
        const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
        const seasonalIndex = await calculateSeasonalIndex();
        const currentMonth = new Date().getMonth() + 1;
        const seasonFactor = seasonalIndex.get(currentMonth) || 1.0;

        const products = await prisma.product.findMany({
            where: { isActive: true, ...deptFilter },
            include: { category: true },
            orderBy: { name: "asc" },
        });

        // Check if we have enough data (at least 3 months of sales records)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const salesCount = await prisma.salesRecord.count({
            where: { periodStart: { gte: threeMonthsAgo } },
        });

        if (salesCount === 0) {
            return res.json({
                forecasts: [],
                seasonalIndex: Object.fromEntries(seasonalIndex),
                dataStatus: "insufficient",
                note: "予測に必要なデータが不足しています。CSVを3ヶ月分以上インポートしてください。",
            });
        }

        const forecasts = [];
        for (const product of products) {
            // Get weekly sales for last 4 weeks
            const fourWeeksAgo = new Date();
            fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

            const sales = await prisma.salesRecord.findMany({
                where: { productId: product.id, periodStart: { gte: fourWeeksAgo } },
                orderBy: { periodStart: "asc" },
            });

            if (sales.length === 0) continue;

            // Group into weekly buckets
            const weeklySales: number[] = [];
            const now = Date.now();
            for (let w = 3; w >= 0; w--) {
                const weekStart = new Date(now - (w + 1) * 7 * 24 * 60 * 60 * 1000);
                const weekEnd = new Date(now - w * 7 * 24 * 60 * 60 * 1000);
                const weekTotal = sales
                    .filter((s) => new Date(s.periodStart) >= weekStart && new Date(s.periodStart) < weekEnd)
                    .reduce((sum, s) => sum + s.quantitySold, 0);
                weeklySales.push(weekTotal);
            }

            // Weighted moving average (weights: 4,3,2,1 for most recent first)
            const weights = [4, 3, 2, 1];
            let weightedSum = 0;
            let weightTotal = 0;
            for (let i = 0; i < Math.min(weeklySales.length, weights.length); i++) {
                const idx = weeklySales.length - 1 - i;
                weightedSum += weeklySales[idx] * weights[i];
                weightTotal += weights[i];
            }
            const weeklyForecast = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

            // Apply seasonal index
            const adjustedWeekly = Math.round(weeklyForecast * seasonFactor);
            const adjustedMonthly = Math.round(adjustedWeekly * 4);

            // Recommended stock = forecast monthly + safety stock - current stock
            const safetyStock = Math.ceil(adjustedWeekly * 0.5);
            const recommended = Math.max(0, adjustedMonthly + safetyStock - product.currentStock);

            // Recent weekly (last week actual)
            const recentWeekly = weeklySales[weeklySales.length - 1] || 0;

            forecasts.push({
                id: product.id,
                name: product.name,
                category: product.category.displayName,
                currentStock: product.currentStock,
                recentWeekly,
                weekForecast: adjustedWeekly,
                monthForecast: adjustedMonthly,
                recommended,
                seasonFactor,
                sparkline: weeklySales,
            });
        }

        // Sort by monthly forecast descending
        forecasts.sort((a, b) => b.monthForecast - a.monthForecast);

        res.json({
            forecasts,
            seasonalIndex: Object.fromEntries(seasonalIndex),
            dataStatus: forecasts.length > 0 ? "ready" : "insufficient",
            note: forecasts.length === 0
                ? "予測に必要なデータが不足しています。CSVを3ヶ月分以上インポートしてください。"
                : null,
        });
    } catch (error) {
        console.error("Forecast error:", error);
        res.json({ forecasts: [], seasonalIndex: {}, dataStatus: "error", note: "予測中にエラーが発生しました" });
    }
});

// GET /api/analytics/recommendations
analyticsRouter.get("/recommendations", async (req, res) => {
    try {
        const department = req.query.department as string | undefined;
        const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
        const products = await prisma.product.findMany({
            where: { isActive: true, ...deptFilter },
            include: { category: true },
            orderBy: { name: "asc" },
        });

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const recommendations = [];

        for (const product of products) {
            // Recent 3 months sales
            const recentSales = await prisma.salesRecord.findMany({
                where: { productId: product.id, periodStart: { gte: threeMonthsAgo } },
            });
            const recentTotal = recentSales.reduce((sum, s) => sum + s.quantitySold, 0);
            const recentRevenue = recentSales.reduce((sum, s) => sum + s.netSales, 0);

            // Previous 3 months (for comparison)
            const prevSales = await prisma.salesRecord.findMany({
                where: {
                    productId: product.id,
                    periodStart: { gte: sixMonthsAgo, lt: threeMonthsAgo },
                },
            });
            const prevTotal = prevSales.reduce((sum, s) => sum + s.quantitySold, 0);

            // Daily average sales
            const daysSince = Math.max(1, Math.round((Date.now() - threeMonthsAgo.getTime()) / (1000 * 60 * 60 * 24)));
            const dailyAvg = recentTotal / daysSince;

            // Turnover days
            const turnoverDays = dailyAvg > 0 ? Math.round(product.currentStock / dailyAvg) : 999;

            // Stock value
            const stockValue = product.currentStock * product.costPrice;

            // Determine severity
            let severity: "critical" | "warning" | "observe" | null = null;
            let suggestion = "";

            if (recentTotal === 0 && product.currentStock > 0) {
                severity = "critical";
                suggestion = "発注停止・値引き販売";
            } else if (turnoverDays >= 90) {
                severity = "warning";
                suggestion = "入荷量削減";
            } else if (prevTotal > 0 && recentTotal < prevTotal * 0.7) {
                severity = "observe";
                suggestion = "経過観察";
            }

            if (!severity) continue;

            // Sparkline: monthly sales for last 6 months
            const sparkline: number[] = [];
            for (let m = 5; m >= 0; m--) {
                const monthStart = new Date();
                monthStart.setMonth(monthStart.getMonth() - m - 1);
                monthStart.setDate(1);
                const monthEnd = new Date(monthStart);
                monthEnd.setMonth(monthEnd.getMonth() + 1);
                const monthSales = await prisma.salesRecord.findMany({
                    where: {
                        productId: product.id,
                        periodStart: { gte: monthStart, lt: monthEnd },
                    },
                });
                sparkline.push(monthSales.reduce((sum, s) => sum + s.quantitySold, 0));
            }

            recommendations.push({
                id: product.id,
                name: product.name,
                category: product.category.displayName,
                severity,
                turnoverDays,
                stockValue,
                recentSales: recentRevenue,
                suggestion,
                sparkline,
            });
        }

        // Sort: critical first, then warning, then observe
        const severityOrder: Record<string, number> = { critical: 0, warning: 1, observe: 2 };
        recommendations.sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2));

        res.json({ recommendations });
    } catch (error) {
        console.error("Recommendations error:", error);
        res.json({ recommendations: [] });
    }
});
