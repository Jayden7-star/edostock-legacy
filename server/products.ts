import { Router } from "express";
import { prisma, requireAdmin } from "./index";

export const productsRouter = Router();
export const supplierMappingsRouter = Router();

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
    const { janCode, name, categoryId, costPrice, sellingPrice, reorderPoint, optimalStock, supplyType, salesType, color, size } = req.body;
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
                salesType: salesType || "REGULAR",
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

// PUT /api/products/bulk-update — 一括更新（管理者のみ）
productsRouter.put("/bulk-update", requireAdmin, async (req, res) => {
    const { productIds, updates } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ error: "商品が選択されていません" });
    }
    if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "更新項目がありません" });
    }

    try {
        // 許可するフィールドのみ抽出
        const allowedFields = ["categoryId", "costPrice", "sellingPrice", "reorderPoint", "optimalStock", "supplyType", "salesType", "isActive"];
        const data: Record<string, any> = {};
        for (const field of allowedFields) {
            if (updates[field] !== undefined && updates[field] !== "") {
                if (field === "categoryId" || field === "costPrice" || field === "sellingPrice" || field === "reorderPoint" || field === "optimalStock") {
                    data[field] = parseInt(updates[field]);
                } else if (field === "isActive") {
                    data[field] = updates[field] === true || updates[field] === "true";
                } else {
                    data[field] = updates[field];
                }
            }
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: "有効な更新項目がありません" });
        }

        const result = await prisma.product.updateMany({
            where: { id: { in: productIds.map((id: any) => parseInt(id)) } },
            data,
        });

        res.json({ success: true, updatedCount: result.count });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "一括更新に失敗しました" });
    }
});

// PUT /api/products/bulk-stock — 在庫数の一括設定（管理者のみ）
// 在庫変更はinventory_transactionsに記録が必要なのでupdateManyではなく個別処理
productsRouter.put("/bulk-stock", requireAdmin, async (req, res) => {
    const userId = (req.session as any).userId;
    const { items } = req.body; // [{ productId: number, newStock: number }]
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "商品が選択されていません" });
    }

    try {
        let updatedCount = 0;
        for (const item of items) {
            const productId = parseInt(item.productId);
            const newStock = parseInt(item.newStock);
            if (isNaN(productId) || isNaN(newStock)) continue;

            // マイナス在庫バリデーション
            if (newStock < 0) {
                return res.status(400).json({ error: "在庫がマイナスになるため処理できません" });
            }

            await prisma.$transaction(async (tx) => {
                const product = await tx.product.findUnique({ where: { id: productId } });
                if (!product) return;

                const diff = newStock - product.currentStock;
                if (diff === 0) return;

                await tx.product.update({
                    where: { id: productId },
                    data: { currentStock: newStock },
                });

                await tx.inventoryTransaction.create({
                    data: {
                        productId,
                        type: "ADJUSTMENT",
                        quantity: diff,
                        stockAfter: newStock,
                        note: "一括在庫調整",
                        userId,
                    },
                });

                updatedCount++;
            });
        }

        res.json({ success: true, updatedCount });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "在庫一括更新に失敗しました" });
    }
});

// PUT /api/products/:id — 商品編集（管理者のみ）
productsRouter.put("/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { janCode, name, categoryId, costPrice, sellingPrice, reorderPoint, optimalStock, supplyType, salesType, color, size,
        optimalStock01, optimalStock02, optimalStock03, optimalStock04, optimalStock05, optimalStock06,
        optimalStock07, optimalStock08, optimalStock09, optimalStock10, optimalStock11, optimalStock12 } = req.body;
    try {
        const monthlyData: Record<string, number> = {};
        const monthlyFields = [
            "optimalStock01", "optimalStock02", "optimalStock03", "optimalStock04",
            "optimalStock05", "optimalStock06", "optimalStock07", "optimalStock08",
            "optimalStock09", "optimalStock10", "optimalStock11", "optimalStock12",
        ] as const;
        const monthlyValues = [optimalStock01, optimalStock02, optimalStock03, optimalStock04,
            optimalStock05, optimalStock06, optimalStock07, optimalStock08,
            optimalStock09, optimalStock10, optimalStock11, optimalStock12];
        monthlyFields.forEach((field, i) => {
            if (monthlyValues[i] !== undefined) {
                monthlyData[field] = parseInt(monthlyValues[i]) || 0;
            }
        });

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
                ...(salesType !== undefined && { salesType }),
                ...(color !== undefined && { color: color || null }),
                ...(size !== undefined && { size: size || null }),
                ...monthlyData,
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

// PATCH /api/products/:id/review — 確認済みにする（管理者のみ）
productsRouter.patch("/:id/review", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { reorderPoint } = req.body;
    try {
        const data: Record<string, any> = { needsReview: false };
        if (reorderPoint !== undefined) {
            data.reorderPoint = parseInt(reorderPoint) || 0;
        }
        const product = await prisma.product.update({
            where: { id },
            data,
            include: { category: true },
        });
        res.json(product);
    } catch (error: any) {
        if (error.code === "P2025") return res.status(404).json({ error: "商品が見つかりません" });
        res.status(500).json({ error: error.message || "確認処理に失敗しました" });
    }
});

// ========== SupplierProductMapping API ==========

// GET /api/supplier-mappings — マッピング一覧（?supplier= でフィルタ可能）
supplierMappingsRouter.get("/", async (req, res) => {
    const supplier = req.query.supplier as string | undefined;
    try {
        const mappings = await prisma.supplierProductMapping.findMany({
            where: supplier ? { supplierName: supplier } : {},
            include: { product: { select: { id: true, name: true, janCode: true } } },
            orderBy: [{ supplierName: "asc" }, { supplierProductName: "asc" }],
        });
        res.json(mappings);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "マッピングの取得に失敗しました" });
    }
});

// PUT /api/supplier-mappings/:id — 紐づけ先の変更（管理者のみ）
supplierMappingsRouter.put("/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { productId } = req.body;
    if (!productId) {
        return res.status(400).json({ error: "紐づけ先の商品IDは必須です" });
    }
    try {
        const mapping = await prisma.supplierProductMapping.update({
            where: { id },
            data: { productId: parseInt(productId) },
            include: { product: { select: { id: true, name: true, janCode: true } } },
        });
        res.json(mapping);
    } catch (error: any) {
        if (error.code === "P2025") return res.status(404).json({ error: "マッピングが見つかりません" });
        res.status(500).json({ error: error.message || "マッピングの更新に失敗しました" });
    }
});

// DELETE /api/supplier-mappings/:id — マッピング削除（管理者のみ）
supplierMappingsRouter.delete("/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await prisma.supplierProductMapping.delete({ where: { id } });
        res.json({ success: true });
    } catch (error: any) {
        if (error.code === "P2025") return res.status(404).json({ error: "マッピングが見つかりません" });
        res.status(500).json({ error: error.message || "マッピングの削除に失敗しました" });
    }
});
