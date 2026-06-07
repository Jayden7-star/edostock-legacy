import { Router } from "express";
import { prisma } from "./index.js";
import {
    batchAdjustInventory,
    InventoryAdjustInputError,
    InventoryAdjustServiceError,
} from "./inventory-adjust-service.js";
import {
    recordStockIn,
    StockInInputError,
    StockInServiceError,
} from "./inventory-stockin-service.js";
import { getProductTransactions, ProductNotFoundError } from "./inventory-history-service.js";
import { getAutoCreatedProducts } from "./auto-created-products-service.js";

export const inventoryRouter = Router();

// クエリ文字列の整数パース。未指定・空・非数値は undefined を返し、サービス側の既定値に委ねる。
function parseOptionalInt(value: unknown): number | undefined {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

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

// GET /api/inventory/auto-created-products — 自動登録・要確認商品の監査台帳（read-only）
// 取込で商品マスタに無いJANに対し自動作成された商品（is_auto_created=true、確認済み含む）を一覧する。
// 静的GET群（/alerts と同様）に置き、動的 /:productId/transactions より前に登録する。
// 認証は /api/inventory マウント時の requireAuth を継承（監査・確認用途のため STAFF も閲覧可。ADMIN限定にしない）。
// read-only: service は findMany/count のみで、currentStock も inventory_transactions も変更しない。
inventoryRouter.get("/auto-created-products", async (req, res) => {
    try {
        const result = await getAutoCreatedProducts(prisma, {
            department: req.query.department as string | undefined,
            reviewStatus: req.query.reviewStatus as string | undefined,
            // placeholderOnly は文字列 "true" のときのみ true（それ以外・配列・未指定は false）。
            placeholderOnly: req.query.placeholderOnly === "true",
            search: req.query.search as string | undefined,
            // 壊れた/未指定の値は undefined になり、service 側の正規化（既定値・範囲制限）に委ねる。
            limit: parseOptionalInt(req.query.limit),
            offset: parseOptionalInt(req.query.offset),
        });
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "自動登録商品一覧の取得に失敗しました" });
    }
});

// GET /api/inventory/:productId/transactions — 商品単位の在庫変動履歴（新しい順 / read-only）
// この商品の現在庫が「なぜその数なのか」を説明するための監査証跡を返す。
// 認証は /api/inventory マウント時の requireAuth を継承（STAFF / ADMIN とも閲覧可）。
inventoryRouter.get("/:productId/transactions", async (req, res) => {
    const productId = parseInt(req.params.productId, 10);
    if (Number.isNaN(productId) || productId <= 0) {
        return res.status(400).json({ error: "商品IDが不正です" });
    }

    const limit = parseOptionalInt(req.query.limit);
    const offset = parseOptionalInt(req.query.offset);
    const type =
        typeof req.query.type === "string" && req.query.type.trim() !== "" ? req.query.type : undefined;

    try {
        const result = await getProductTransactions(prisma, productId, { limit, offset, type });
        res.json(result);
    } catch (error: any) {
        if (error instanceof ProductNotFoundError) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message || "在庫履歴の取得に失敗しました" });
    }
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

    // 入庫（仕入による現在庫への加算）は厳格バリデーション付きの自己完結サービスに委譲する。
    // 直接変更（type === "ADJUSTMENT"）は従来どおり下のブロックでインライン処理する（挙動を据え置き）。
    if (type !== "ADJUSTMENT") {
        try {
            const { newStock } = await recordStockIn(prisma, { productId, quantity, note }, userId);
            return res.json({ success: true, newStock });
        } catch (error: any) {
            if (error instanceof StockInInputError) {
                return res.status(400).json({ error: error.message });
            }
            if (error instanceof StockInServiceError && error.code === "PRODUCT_NOT_FOUND") {
                return res.status(404).json({ error: error.message });
            }
            return res.status(500).json({ error: error.message || "入庫処理に失敗しました" });
        }
    }

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

// PUT /api/inventory/batch — 複数商品の実在庫を一括保存（単一トランザクション / fail-all）
// body: { items: [{ productId, actualStock, note? }] }
inventoryRouter.put("/batch", async (req, res) => {
    const userId = (req.session as any).userId;
    const { items } = req.body;

    try {
        const result = await batchAdjustInventory(prisma, items, userId);
        res.json(result);
    } catch (error: any) {
        if (error instanceof InventoryAdjustInputError) {
            return res.status(400).json({ error: error.message });
        }
        if (error instanceof InventoryAdjustServiceError && error.code === "PRODUCT_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: error.message || "一括在庫保存に失敗しました" });
    }
});
