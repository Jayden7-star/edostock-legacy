import { Router } from "express";
import { prisma } from "./index.js";

export const inventoryRouter = Router();

inventoryRouter.get("/", async (req, res) => {
    const status = req.query.status as string | undefined;
    const products = await prisma.product.findMany({
        where: { isActive: true },
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
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: "商品が見つかりません" });

    const newStock = type === "ADJUSTMENT" ? quantity : product.currentStock + quantity;
    const delta = type === "ADJUSTMENT" ? quantity - product.currentStock : quantity;

    await prisma.$transaction([
        prisma.product.update({ where: { id: productId }, data: { currentStock: newStock } }),
        prisma.inventoryTransaction.create({
            data: { productId, type, quantity: delta, stockAfter: newStock, note, userId },
        }),
    ]);

    res.json({ success: true, newStock });
});

inventoryRouter.get("/alerts", async (_req, res) => {
    const products = await prisma.product.findMany({
        where: { isActive: true, reorderPoint: { gt: 0 } },
        include: { category: true },
    });
    const alerts = products
        .filter((p) => p.currentStock <= p.reorderPoint)
        .map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category.displayName,
            currentStock: p.currentStock,
            reorderPoint: p.reorderPoint,
            optimalStock: p.optimalStock,
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
    res.json(alerts);
});
