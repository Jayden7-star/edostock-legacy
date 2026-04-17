import { Router } from "express";
import { prisma } from "./index.js";

export const inventoryRouter = Router();

inventoryRouter.get("/alerts", async (req, res) => {
    const department = req.query.department as string | undefined;
    const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
    const products = await prisma.product.findMany({
        where: { isActive: true, reorderPoint: { gt: 0 }, ...deptFilter },
        include: { category: true },
    });
    // APPAREL商品は当月の月別適正在庫を使用（全て0ならfallback）
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const monthlyField = `optimalStock${String(currentMonth).padStart(2, "0")}` as keyof typeof products[0];

    const getOptimalStock = (p: typeof products[0]) => {
        if (p.category.department === "APPAREL") {
            const monthlyValue = (p as any)[monthlyField] as number;
            if (monthlyValue > 0) return monthlyValue;
            // 全月が0かチェック — いずれかが設定されていればその月は0として扱う
            const anyMonthlySet = [
                p.optimalStock01, p.optimalStock02, p.optimalStock03, p.optimalStock04,
                p.optimalStock05, p.optimalStock06, p.optimalStock07, p.optimalStock08,
                p.optimalStock09, p.optimalStock10, p.optimalStock11, p.optimalStock12,
            ].some((v) => v > 0);
            if (anyMonthlySet) return monthlyValue; // 当月は0
        }
        return p.optimalStock; // FOOD/GOODS or APPAREL fallback
    };

    const alerts = products
        .filter((p) => p.currentStock <= p.reorderPoint)
        .map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category.displayName,
            department: p.category.department,
            currentStock: p.currentStock,
            reorderPoint: p.reorderPoint,
            optimalStock: getOptimalStock(p),
            severity:
                p.currentStock <= 0
                    ? "critical"
                    : p.currentStock <= p.reorderPoint * 0.5
                        ? "critical"
                        : ("warning" as const),
        }))
        .sort((a, b) => {
            const order: Record<string, number> = { critical: 0, warning: 1 };
            return (order[a.severity] ?? 1) - (order[b.severity] ?? 1) || a.currentStock - b.currentStock;
        });
    // 要確認商品（自動登録された未レビュー商品）
    const reviewProducts = await prisma.product.findMany({
        where: { isActive: true, needsReview: true, ...deptFilter },
        include: { category: true },
        orderBy: { createdAt: "desc" },
    });
    const reviewAlerts = reviewProducts.map((p) => ({
        id: p.id,
        name: p.name,
        janCode: p.janCode,
        category: p.category.displayName,
        department: p.category.department,
        currentStock: p.currentStock,
        reorderPoint: p.reorderPoint,
        createdAt: p.createdAt,
    }));

    res.json({ lowStockAlerts: alerts, reviewAlerts });
});

inventoryRouter.patch("/:id/deactivate", async (req, res) => {
    const id = parseInt(req.params.id);
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true });
});

inventoryRouter.get("/", async (req, res) => {
    const status = req.query.status as string | undefined;
    const department = req.query.department as string | undefined;
    const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
    const products = await prisma.product.findMany({
        where: { isActive: true, ...deptFilter },
        include: { category: true },
        orderBy: { name: "asc" },
    });

    let filtered = products;
    if (status === "out") filtered = products.filter((p) => p.currentStock <= 0);
    else if (status === "low") filtered = products.filter((p) => p.reorderPoint > 0 && p.currentStock > 0 && p.currentStock <= p.reorderPoint);
    else if (status === "ok") filtered = products.filter((p) => p.reorderPoint === 0 || p.currentStock > p.reorderPoint);

    res.json(filtered);
});

inventoryRouter.post("/", async (req, res) => {
    const { productId, quantity, note, type = "PURCHASE" } = req.body;
    const userId = (req.session as any).userId;

    try {
        const newStock = await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: productId } });
            if (!product) throw new Error("NOT_FOUND");

            const resultStock = type === "ADJUSTMENT" ? quantity : product.currentStock + quantity;
            const delta = type === "ADJUSTMENT" ? quantity - product.currentStock : quantity;

            // マイナス在庫バリデーション
            if (type === "ADJUSTMENT" && quantity < 0) {
                throw new Error("NEGATIVE_STOCK");
            }
            if (type !== "ADJUSTMENT" && resultStock < 0) {
                throw new Error("NEGATIVE_STOCK");
            }

            await tx.product.update({ where: { id: productId }, data: { currentStock: resultStock } });
            await tx.inventoryTransaction.create({
                data: { productId, type, quantity: delta, stockAfter: resultStock, note, userId },
            });

            return resultStock;
        });

        res.json({ success: true, newStock });
    } catch (error: any) {
        if (error.message === "NOT_FOUND") {
            return res.status(404).json({ error: "商品が見つかりません" });
        }
        if (error.message === "NEGATIVE_STOCK") {
            return res.status(400).json({ error: "在庫がマイナスになるため処理できません" });
        }
        res.status(500).json({ error: error.message || "在庫操作に失敗しました" });
    }
});
