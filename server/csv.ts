import { Router } from "express";
import { prisma } from "./index.js";
import {
    findMissingProductSalesColumns,
    hasValidSalesLine,
    CSV_COLUMN_ERROR_MESSAGE,
    CSV_NO_SALES_LINE_MESSAGE,
} from "./csv-validation.js";
import { importProductSales } from "./csv-sales-service.js";
import { computeContentHash, findContentHashDuplicate } from "./csv-dedup.js";

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
            // P0: 必須列チェック。文字コード不一致/列欠落で全行 undefined になり、
            // 「130件取り込んだが在庫が1件も減らない」サイレント成功を防ぐ。
            // csvImport を作る前に弾くので、空振りCOMPLETEDが残って再取込が409になる二次被害も起きない。
            const missingColumns = findMissingProductSalesColumns(records);
            if (missingColumns.length > 0) {
                return res.status(400).json({ error: CSV_COLUMN_ERROR_MESSAGE });
            }
            // P0: 有効な売上明細が0件なら成功扱いにしない。
            if (!hasValidSalesLine(records)) {
                return res.status(400).json({ error: CSV_NO_SALES_LINE_MESSAGE });
            }

            // 重複チェック(強化): 内容ハッシュで COMPLETED 済みを検知し 409 でハードブロックする。
            // ファイル名ベースの検知（リネームですり抜ける／別内容でも同名なら誤ブロック）を置換。
            // ※このパスでは「再取込許可」ボタンは出さない（ハードブロック）。
            const contentHash = computeContentHash(records);
            const dupByHash = await findContentHashDuplicate(prisma, {
                contentHash,
                csvType: "PRODUCT_SALES",
            });
            if (dupByHash) {
                console.log(`売上CSV重複検知(内容一致): importId=${dupByHash.id} 既存ファイル名=${dupByHash.filename}`);
                return res.status(409).json({
                    error: `この売上CSVは既にインポート済みです（内容が一致：${dupByHash.filename} / ${dupByHash.importedAt.toLocaleString("ja-JP")}）。ファイル名が違っても内容で検知しています。`,
                    duplicate: {
                        id: dupByHash.id,
                        filename: dupByHash.filename,
                        importedAt: dupByHash.importedAt,
                    },
                });
            }

            // P1-1: 確定処理の中核（csvImport 作成・在庫減算・inventory_transactions 作成・
            // status=COMPLETED 更新・失敗時のゴースト削除）は csv-sales-service.ts に切り出した。
            // route 側は検証(400) / 重複チェック(409) / レスポンス整形のみを担う。
            const result = await importProductSales(
                prisma,
                { records, filename, periodStart, periodEnd, overrideMap, contentHash },
                userId
            );

            return res.json({
                success: true,
                importId: result.importId,
                recordCount: result.recordCount,
                autoCreatedCount: result.autoCreatedCount,
                contentHash: result.contentHash,
                importedAt: result.importedAt,
                periodStart,
                periodEnd,
                filename,
                duplicateStatus: "none",
                summary: result.summary,
                clampedItems: result.clampedItems,
            });
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
        const { records, csvType } = req.body;

        // P0: confirm と同じ必須列/明細チェックを共有し、previewで問題が見えず
        // confirmで空振りする状態を防ぐ。MONTHLY_SALES も preview を通るため
        // PRODUCT_SALES のときだけ適用して月次取込を壊さない。
        if (csvType === "PRODUCT_SALES") {
            const missingColumns = findMissingProductSalesColumns(records);
            if (missingColumns.length > 0) {
                return res.status(400).json({ error: CSV_COLUMN_ERROR_MESSAGE });
            }
            if (!hasValidSalesLine(records)) {
                return res.status(400).json({ error: CSV_NO_SALES_LINE_MESSAGE });
            }
        }

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
