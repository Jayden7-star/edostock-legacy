import { Router } from "express";
import { prisma } from "./index.js";

export const csvRouter = Router();

csvRouter.post("/", async (req, res) => {
    try {
        const { records, csvType, filename, periodStart, periodEnd, matchOverrides } = req.body;
        const userId = (req.session as any).userId;

        // matchOverridesをMapに変換（csvJanCode → { csvProductName, existingProductId }）
        const overrideMap = new Map<string, { csvProductName: string; existingProductId: number }>();
        if (Array.isArray(matchOverrides)) {
            for (const o of matchOverrides) {
                overrideMap.set(o.csvJanCode, { csvProductName: o.csvProductName, existingProductId: o.existingProductId });
            }
        }

        if (csvType === "PRODUCT_SALES") {
            // 重複チェック: 同一ファイル名+期間のCOMPLETED済みレコードがあれば409
            if (filename) {
                const existing = await prisma.csvImport.findFirst({
                    where: {
                        filename,
                        csvType: "PRODUCT_SALES",
                        periodStart: new Date(periodStart),
                        periodEnd: new Date(periodEnd),
                        status: "COMPLETED",
                    },
                });
                if (existing) {
                    console.log(`売上CSV重複検知: ${filename} (importId: ${existing.id})`);
                    return res.status(409).json({
                        error: `この売上CSVは既にインポート済みです（ファイル名: ${filename}）`,
                    });
                }
            }

            // PENDING状態で作成 → トランザクション成功時にCOMPLETEDに更新
            const csvImport = await prisma.csvImport.create({
                data: {
                    filename, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
                    csvType: "PRODUCT_SALES", recordCount: records.length, userId, status: "PENDING",
                },
            });

            try {
            // P1-1: forループ全体を prisma.$transaction でラップ
            await prisma.$transaction(async (tx) => {
            for (const record of records) {
                const janCode = record["商品コード"]?.trim();
                const productName = record["商品名"]?.trim() || "";

                // 合計行はスキップ
                if (janCode === "合計" || productName === "合計") continue;

                // 商品コード空欄行 → discount_records に保存
                if (!janCode || janCode === "") {
                    const amount = parseInt(record["値引き後計"]) || 0;
                    if (amount === 0) continue; // 金額0の空行はスキップ

                    const recordType = amount < 0 ? "DISCOUNT" : "SET_ITEM";
                    const transactionDate = record["取引日時"]?.trim();
                    await tx.discountRecord.create({
                        data: {
                            csvImportId: csvImport.id,
                            recordType,
                            itemName: productName,
                            amount,
                            transactionId: record["取引ID"]?.trim() || null,
                            transactionDate: transactionDate ? new Date(transactionDate) : null,
                            bundleGroupId: record["商品バンドルグループID"]?.trim() || null,
                        },
                    });
                    continue;
                }

                const quantitySold = parseInt(record["数量"]) || 0;
                const netSales = parseInt(record["値引き後計"]) || 0;
                const categoryName = record["部門名"]?.trim() || "";

                let product = await tx.product.findUnique({ where: { janCode } });
                if (!product) {
                    const override = overrideMap.get(janCode);
                    if (override) {
                        // 手動マッチング: 既存商品のJAN・名前をスマレジのデータに更新
                        product = await tx.product.update({
                            where: { id: override.existingProductId },
                            data: { janCode, name: override.csvProductName },
                        });
                    } else {
                        // 新規商品として登録（従来通り）
                        let category = await tx.category.findUnique({ where: { name: categoryName } });
                        if (!category) {
                            category = await tx.category.create({
                                data: { name: categoryName, displayName: categoryName.replace("☆　", ""), isFood: !categoryName.startsWith("☆"), displayOrder: 99 },
                            });
                        }
                        product = await tx.product.create({
                            data: {
                                janCode, name: productName, categoryId: category.id,
                                color: record["カラー"]?.trim() || null, size: record["サイズ"]?.trim() || null,
                                sellingPrice: quantitySold > 0 ? Math.round(netSales / quantitySold) : 0,
                            },
                        });
                    }
                }

                await tx.salesRecord.create({
                    data: { productId: product.id, csvImportId: csvImport.id, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), quantitySold, netSales },
                });

                // 在庫数が設定されている商品のみ減算（null = 棚卸し未実施はスキップ）
                if (product.currentStock !== null) {
                    // P0-2: マイナス在庫ガード
                    const rawStock = product.currentStock - quantitySold;
                    const clamped = rawStock < 0;
                    const newStock = Math.max(0, rawStock);

                    if (clamped) {
                        console.warn(`⚠️ マイナス在庫クランプ: ${product.name} (ID:${product.id}) 計算値=${rawStock} → 0`);
                    }

                    await tx.product.update({
                        where: { id: product.id },
                        data: { currentStock: newStock },
                    });

                    // P0-1: InventoryTransaction 作成
                    const noteBase = `売上CSV: ${csvImport.filename || filename}`;
                    await tx.inventoryTransaction.create({
                        data: {
                            productId: product.id,
                            type: "SALE_CSV",
                            quantity: quantitySold,
                            stockAfter: newStock,
                            note: clamped ? `${noteBase} ⚠️ マイナス在庫を0にクランプ` : noteBase,
                            csvImportId: csvImport.id,
                            userId,
                        },
                    });
                }
            }
            }, { timeout: 30000 });

            // トランザクション成功 → COMPLETEDに更新
            await prisma.csvImport.update({
                where: { id: csvImport.id },
                data: { status: "COMPLETED" },
            });

            return res.json({ success: true, importId: csvImport.id, recordCount: records.length });
            } catch (txError) {
                // トランザクション失敗 → ゴーストレコード削除
                console.error("売上CSVトランザクション失敗、PENDINGレコードを削除:", txError);
                await prisma.csvImport.delete({ where: { id: csvImport.id } }).catch(() => {});
                throw txError;
            }
        }

        if (csvType === "MONTHLY_SALES") {
            // 重複チェック: 同一ファイル名+期間のCOMPLETED済みレコードがあれば409
            if (filename) {
                const existing = await prisma.csvImport.findFirst({
                    where: {
                        filename,
                        csvType: "MONTHLY_SALES",
                        periodStart: new Date(periodStart),
                        periodEnd: new Date(periodEnd),
                        status: "COMPLETED",
                    },
                });
                if (existing) {
                    console.log(`月次売上CSV重複検知: ${filename} (importId: ${existing.id})`);
                    return res.status(409).json({
                        error: `この売上CSVは既にインポート済みです（ファイル名: ${filename}）`,
                    });
                }
            }

            const csvImport = await prisma.csvImport.create({
                data: {
                    filename, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
                    csvType: "MONTHLY_SALES", recordCount: records.length, userId, status: "PENDING",
                },
            });

            try {
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

            // 成功 → COMPLETEDに更新
            await prisma.csvImport.update({
                where: { id: csvImport.id },
                data: { status: "COMPLETED" },
            });

            return res.json({ success: true, importId: csvImport.id, recordCount: records.length });
            } catch (txError) {
                // 失敗 → ゴーストレコード削除
                console.error("月次売上CSVインポート失敗、PENDINGレコードを削除:", txError);
                await prisma.csvImport.delete({ where: { id: csvImport.id } }).catch(() => {});
                throw txError;
            }
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

        // JANコードごとに集計 + 値引き・セット売り集計
        const aggregated: Record<string, { productName: string; soldQty: number }> = {};
        let discountTotal = 0;
        let setItemTotal = 0;
        let discountCount = 0;
        let setItemCount = 0;
        for (const record of records) {
            const janCode = record["商品コード"]?.trim();
            const productName = record["商品名"]?.trim() || "";
            if (janCode === "合計" || productName === "合計") continue;

            if (!janCode || janCode === "") {
                const amount = parseInt(record["値引き後計"]) || 0;
                if (amount < 0) { discountTotal += amount; discountCount++; }
                else if (amount > 0) { setItemTotal += amount; setItemCount++; }
                continue;
            }

            const soldQty = parseInt(record["数量"]) || 0;
            if (!aggregated[janCode]) {
                aggregated[janCode] = { productName, soldQty: 0 };
            }
            aggregated[janCode].soldQty += soldQty;
        }

        const matched: { productName: string; currentStock: number | null; soldQty: number; afterStock: number | null }[] = [];
        const unmatched: { janCode: string; productName: string; soldQty: number; candidates: { id: number; janCode: string; name: string }[] }[] = [];

        for (const [janCode, { productName, soldQty }] of Object.entries(aggregated)) {
            const product = await prisma.product.findUnique({ where: { janCode } });
            if (product) {
                const afterStock = product.currentStock !== null ? product.currentStock - soldQty : null;
                matched.push({ productName: product.name, currentStock: product.currentStock, soldQty, afterStock });
            } else {
                // あいまい検索: 商品名のキーワードで候補を探す
                const keywords = productName.replace(/[\s　]+/g, " ").trim().split(" ").filter((k: string) => k.length >= 2);
                let candidates: { id: number; janCode: string; name: string }[] = [];
                if (keywords.length > 0) {
                    const whereConditions = keywords.map((kw: string) => ({ name: { contains: kw } }));
                    candidates = await prisma.product.findMany({
                        where: { isActive: true, OR: whereConditions },
                        select: { id: true, janCode: true, name: true },
                        take: 10,
                    });
                }
                unmatched.push({ janCode, productName, soldQty, candidates });
            }
        }

        res.json({ matched, unmatched, discountTotal, setItemTotal, discountCount, setItemCount });
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
