import { Router } from "express";
import { prisma } from "./index.js";

export const csvRouter = Router();

csvRouter.post("/", async (req, res) => {
    try {
        const { records, csvType, filename, periodStart, periodEnd } = req.body;
        const userId = (req.session as any).userId;

        if (csvType === "PRODUCT_SALES") {
            const csvImport = await prisma.csvImport.create({
                data: {
                    filename, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
                    csvType: "PRODUCT_SALES", recordCount: records.length, userId, status: "COMPLETED",
                },
            });

            for (const record of records) {
                const janCode = record["商品コード"]?.trim();
                if (!janCode || janCode === "合計" || janCode === "") continue;

                const quantitySold = parseInt(record["数量"]) || 0;
                const netSales = parseInt(record["値引き後計"]) || 0;
                const categoryName = record["部門名"]?.trim() || "";
                const productName = record["商品名"]?.trim() || "";

                let product = await prisma.product.findUnique({ where: { janCode } });
                if (!product) {
                    let category = await prisma.category.findUnique({ where: { name: categoryName } });
                    if (!category) {
                        category = await prisma.category.create({
                            data: { name: categoryName, displayName: categoryName.replace("☆　", ""), isFood: !categoryName.startsWith("☆"), displayOrder: 99 },
                        });
                    }
                    product = await prisma.product.create({
                        data: {
                            janCode, name: productName, categoryId: category.id,
                            color: record["カラー"]?.trim() || null, size: record["サイズ"]?.trim() || null,
                            sellingPrice: quantitySold > 0 ? Math.round(netSales / quantitySold) : 0,
                        },
                    });
                }

                await prisma.salesRecord.create({
    data: { productId: product.id, csvImportId: csvImport.id, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), quantitySold, netSales },
});

// 在庫数が設定されている商品のみ減算（null = 棚卸し未実施はスキップ）
if (product.currentStock !== null) {
    await prisma.product.update({
        where: { id: product.id },
        data: { currentStock: { decrement: quantitySold } },
    });
}
            }

            return res.json({ success: true, importId: csvImport.id, recordCount: records.length });
        }

        if (csvType === "MONTHLY_SALES") {
            const csvImport = await prisma.csvImport.create({
                data: {
                    filename, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
                    csvType: "MONTHLY_SALES", recordCount: records.length, userId, status: "COMPLETED",
                },
            });

            for (const record of records) {
                const dateStr = record["日付"]?.trim();
                if (!dateStr || dateStr === "合計") continue;
                const [year, month] = dateStr.split("/").map(Number);
                const monthDate = new Date(year, month - 1, 1);

                await prisma.monthlySales.upsert({
                    where: { month: monthDate },
                    update: {
                        netSales: parseInt(record["純売上"]) || 0,
                        netSalesExTax: parseInt(record["純売上(税抜)"]) || 0,
                        taxAmount: parseInt(record["消費税"]) || 0,
                        grossSales: parseInt(record["総売上"]) || 0,
                        discountAmount: parseInt(record["値引き"]) || 0,
                        itemsSold: parseInt(record["販売点数"]) || 0,
                        csvImportId: csvImport.id,
                    },
                    create: {
                        month: monthDate,
                        netSales: parseInt(record["純売上"]) || 0,
                        netSalesExTax: parseInt(record["純売上(税抜)"]) || 0,
                        taxAmount: parseInt(record["消費税"]) || 0,
                        grossSales: parseInt(record["総売上"]) || 0,
                        discountAmount: parseInt(record["値引き"]) || 0,
                        itemsSold: parseInt(record["販売点数"]) || 0,
                        csvImportId: csvImport.id,
                    },
                });
            }

            return res.json({ success: true, importId: csvImport.id, recordCount: records.length });
        }

        res.status(400).json({ error: "不明なCSVタイプです" });
    } catch (error) {
        console.error("CSV import error:", error);
        res.status(500).json({ error: "インポートに失敗しました" });
    }
});

csvRouter.post("/preview", async (req, res) => {
    try {
        const { records } = req.body;

        // JANコードごとに集計
        const aggregated: Record<string, { productName: string; soldQty: number }> = {};
        for (const record of records) {
            const janCode = record["商品コード"]?.trim();
            if (!janCode || janCode === "合計" || janCode === "") continue;
            const soldQty = parseInt(record["数量"]) || 0;
            const productName = record["商品名"]?.trim() || "";
            if (!aggregated[janCode]) {
                aggregated[janCode] = { productName, soldQty: 0 };
            }
            aggregated[janCode].soldQty += soldQty;
        }

        const matched: { productName: string; currentStock: number | null; soldQty: number; afterStock: number | null }[] = [];
        const unmatched: { janCode: string; productName: string; soldQty: number }[] = [];

        for (const [janCode, { productName, soldQty }] of Object.entries(aggregated)) {
            const product = await prisma.product.findUnique({ where: { janCode } });
            if (product) {
                const afterStock = product.currentStock !== null ? product.currentStock - soldQty : null;
                matched.push({ productName: product.name, currentStock: product.currentStock, soldQty, afterStock });
            } else {
                unmatched.push({ janCode, productName, soldQty });
            }
        }

        res.json({ matched, unmatched });
    } catch (error) {
        console.error("CSV preview error:", error);
        res.status(500).json({ error: "プレビューに失敗しました" });
    }
});

csvRouter.get("/history", async (_req, res) => {
    const history = await prisma.csvImport.findMany({
        orderBy: { importedAt: "desc" },
        include: { user: { select: { name: true } } },
        take: 20,
    });
    res.json(history);
});
