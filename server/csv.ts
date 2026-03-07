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

csvRouter.get("/history", async (_req, res) => {
    const history = await prisma.csvImport.findMany({
        orderBy: { importedAt: "desc" },
        include: { user: { select: { name: true } } },
        take: 20,
    });
    res.json(history);
});
