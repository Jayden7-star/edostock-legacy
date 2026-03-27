import { Router } from "express";
import { prisma, requireAdmin } from "./index";

export const productsRouter = Router();

productsRouter.get("/", async (req, res) => {
    const search = req.query.search as string | undefined;
    const department = req.query.department as string | undefined;
    const deptFilter = department && department !== "ALL" ? { category: { department } } : {};
    const products = await prisma.product.findMany({
        where: {
            isActive: true,
            ...deptFilter,
            ...(search ? { OR: [{ name: { contains: search } }, { janCode: { contains: search } }] } : {}),
        },
        include: { category: true },
        orderBy: { name: "asc" },
    });
    res.json(products);
});

productsRouter.get("/categories", async (_req, res) => {
    const categories = await prisma.category.findMany({ orderBy: { displayOrder: "asc" } });
    res.json(categories);
});

// POST /api/products — 新規商品作成（管理者のみ）
productsRouter.post("/", requireAdmin, async (req, res) => {
    const { janCode, name, categoryId, costPrice, sellingPrice, reorderPoint, optimalStock, supplyType, color, size } = req.body;
    if (!janCode || !name || !categoryId) {
        return res.status(400).json({ error: "商品コード、商品名、部門は必須です" });
    }
    try {
        const existing = await prisma.product.findUnique({ where: { janCode } });
        if (existing) {
            return res.status(409).json({ error: "この商品コードは既に登録されています" });
        }
        const product = await prisma.product.create({
            data: {
                janCode,
                name,
                categoryId: parseInt(categoryId),
                costPrice: parseInt(costPrice) || 0,
                sellingPrice: parseInt(sellingPrice) || 0,
                reorderPoint: parseInt(reorderPoint) || 0,
                optimalStock: parseInt(optimalStock) || 0,
                supplyType: supplyType || "PURCHASED",
                color: color || null,
                size: size || null,
            },
            include: { category: true },
        });
        res.status(201).json(product);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "商品の作成に失敗しました" });
    }
});

// PUT /api/products/:id — 商品編集（管理者のみ）
productsRouter.put("/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { janCode, name, categoryId, costPrice, sellingPrice, reorderPoint, optimalStock, supplyType, color, size } = req.body;
    try {
        const product = await prisma.product.update({
            where: { id },
            data: {
                ...(janCode !== undefined && { janCode }),
                ...(name !== undefined && { name }),
                ...(categoryId !== undefined && { categoryId: parseInt(categoryId) }),
                ...(costPrice !== undefined && { costPrice: parseInt(costPrice) }),
                ...(sellingPrice !== undefined && { sellingPrice: parseInt(sellingPrice) }),
                ...(reorderPoint !== undefined && { reorderPoint: parseInt(reorderPoint) }),
                ...(optimalStock !== undefined && { optimalStock: parseInt(optimalStock) }),
                ...(supplyType !== undefined && { supplyType }),
                ...(color !== undefined && { color: color || null }),
                ...(size !== undefined && { size: size || null }),
            },
            include: { category: true },
        });
        res.json(product);
    } catch (error: any) {
        if (error.code === "P2025") return res.status(404).json({ error: "商品が見つかりません" });
        res.status(500).json({ error: error.message || "商品の更新に失敗しました" });
    }
});

// DELETE /api/products/:id — 論理削除（管理者のみ）
productsRouter.delete("/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await prisma.product.update({ where: { id }, data: { isActive: false } });
        res.json({ success: true });
    } catch (error: any) {
        if (error.code === "P2025") return res.status(404).json({ error: "商品が見つかりません" });
        res.status(500).json({ error: error.message || "商品の削除に失敗しました" });
    }
});
