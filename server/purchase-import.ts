import { Router } from "express";
import { prisma } from "./index";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const purchaseImportRouter = Router();

// Shared: match product by JAN code or name+color fuzzy match
async function matchProduct(
    janCode: string | null,
    itemCode: string | null,
    name: string,
    color: string | null
): Promise<{ id: number; name: string; janCode: string } | null> {
    if (janCode) {
        const product = await prisma.product.findUnique({
            where: { janCode },
            select: { id: true, name: true, janCode: true },
        });
        if (product) return product;
    }

    const cleanName = name
        .replace(/★[^★]*★/g, "")
        .replace(/【[^】]*】/g, "")
        .trim();

    if (color) {
        const byNameAndColor = await prisma.product.findFirst({
            where: {
                isActive: true,
                OR: [
                    { AND: [{ name: { contains: cleanName } }, { color: { contains: color } }] },
                    { name: { contains: `${cleanName} ${color}` } },
                ],
            },
            select: { id: true, name: true, janCode: true },
        });
        if (byNameAndColor) return byNameAndColor;
    }

    const byName = await prisma.product.findFirst({
        where: { isActive: true, name: { contains: cleanName } },
        select: { id: true, name: true, janCode: true },
    });
    if (byName) return byName;

    if (itemCode) {
        const byItemCode = await prisma.product.findUnique({
            where: { janCode: itemCode },
            select: { id: true, name: true, janCode: true },
        });
        if (byItemCode) return byItemCode;
    }

    return null;
}

// Helper: get or create a default category for auto-registered products
async function getOrCreateDefaultCategory(): Promise<number> {
    const existing = await prisma.category.findFirst({ where: { name: "未分類" } });
    if (existing) return existing.id;
    const fallback = await prisma.category.findFirst({ orderBy: { displayOrder: "asc" } });
    if (fallback) return fallback.id;
    const created = await prisma.category.create({
        data: { name: "未分類", displayName: "未分類", isFood: false, displayOrder: 99 },
    });
    return created.id;
}

// ==================================================
//  エトワール海渡 CSV
// ==================================================

purchaseImportRouter.post("/etoile", async (req, res) => {
    const { records } = req.body;
    if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: "データがありません" });
    }

    const results = [];
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const janCode = r["JANコード"]?.trim() || "";
        const itemCode = r["itemCode"]?.trim() || "";
        const rawName = r["商品名"]?.trim() || "";
        const color = r["カラー"]?.trim() || "";
        const size = r["サイズ"]?.trim() || "";
        const quantity = parseInt(r["num"]) || 0;
        const unitCost = parseInt(r["購入卸単価"]) || 0;
        const subtotal = parseInt(r["小計"]) || 0;

        const cleanName = rawName.replace(/★[^★]*★/g, "").replace(/【[^】]*】/g, "").trim();
        const match = await matchProduct(janCode || null, itemCode || null, cleanName, color || null);

        results.push({
            row: i + 1,
            status: match ? "matched" as const : "unmatched" as const,
            itemCode, janCode,
            csvName: `${cleanName}${color ? ` ${color}` : ""}${size ? ` ${size}` : ""}`,
            color, size, quantity, unitCost, subtotal,
            matchedProduct: match?.name || null,
            matchedId: match?.id || null,
        });
    }

    res.json({
        results,
        summary: {
            total: results.length,
            matched: results.filter((r) => r.status === "matched").length,
            unmatched: results.filter((r) => r.status === "unmatched").length,
            totalQuantity: results.reduce((sum, r) => sum + r.quantity, 0),
            totalCost: results.reduce((sum, r) => sum + r.subtotal, 0),
        },
    });
});

purchaseImportRouter.post("/etoile/confirm", async (req, res) => {
    const userId = (req.session as any).userId;
    const { items, orderDate } = req.body;
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "確定データがありません" });
    }

    let addedCount = 0;
    let totalQty = 0;
    let newlyRegistered = 0;

    for (const item of items) {
        const quantity = item.quantity || 0;
        if (quantity <= 0) continue;

        let productId = item.matchedId;

        // Auto-register unmatched products
        if (!productId && item.autoRegister) {
            const categoryId = await getOrCreateDefaultCategory();
            const janCode = item.janCode || `AUTO_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const newProduct = await prisma.product.upsert({
                where: { janCode },
                update: {},
                create: {
                    name: item.csvName || "不明な商品",
                    janCode,
                    categoryId,
                    costPrice: item.unitCost || 0,
                    sellingPrice: 0,
                    currentStock: 0,
                    supplyType: "OEM",
                },
            });
            productId = newProduct.id;
            newlyRegistered++;
        }

        if (!productId) continue;

        const product = await prisma.product.update({
            where: { id: productId },
            data: { currentStock: { increment: quantity } },
        });

        await prisma.inventoryTransaction.create({
            data: {
                productId,
                type: "PURCHASE",
                quantity,
                stockAfter: product.currentStock,
                note: `仕入: エトワール海渡${orderDate ? ` (${orderDate})` : ""}`,
                userId,
            },
        });

        if (item.unitCost && item.unitCost > 0) {
            await prisma.product.update({ where: { id: productId }, data: { costPrice: item.unitCost } });
        }

        addedCount++;
        totalQty += quantity;
    }

    res.json({ success: true, addedCount, totalQuantity: totalQty, newlyRegistered });
});

// ==================================================
//  コレック COREC PDF パーサー
// ==================================================

function normalizeJan(raw: string): string {
    return raw
        .replace(/[\s\u3000]/g, "")
        .replace(/[-‐‑‒–—―ー－]/g, "")
        .replace(/[^\d]/g, "");
}

async function extractPdfText(buffer: Buffer): Promise<string[]> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    // Split by page: TextResult has pages array, each with .text
    if (result.pages && result.pages.length > 0) {
        return result.pages.map((p: any) => p.text).filter((t: string) => t.trim().length > 0);
    }
    // Fallback: use the full text, split by form-feed
    const pages = result.text.split('\f').filter((p: string) => p.trim().length > 0);
    return pages.length > 0 ? pages : [result.text];
}

function parseCorecLines(pageTexts: string[]) {
    const results: Array<{
        hinban: string; productName: string; janCode: string;
        spec: string; quantity: number; unitPrice: number; subtotal: number;
    }> = [];

    const fullText = pageTexts.join(" ");

    // Regex pattern for COREC order lines
    // "233563   たらこ   4970974- 101026   70g 築地   10   ¥232   20   対 象   ¥4,640"
    const lineRegex = /(\d{6})\s+([\u3000-\u9FFF\uF900-\uFAFF\w（）\s]+?)\s+(4970974[\s\-‐‑‒–—―ー－]*[\d\s]+?)\s+(.+?)\s+(\d+)\s+[¥￥]([\d,]+)\s+(\d+)\s+対\s*象\s+[¥￥]([\d,]+)/g;

    let match;
    while ((match = lineRegex.exec(fullText)) !== null) {
        const janCode = normalizeJan(match[3]);
        results.push({
            hinban: match[1],
            productName: match[2].trim(),
            janCode: janCode.length >= 13 ? janCode.substring(0, 13) : janCode,
            spec: match[4].trim(),
            quantity: parseInt(match[7]) || 0,
            unitPrice: parseInt(match[6].replace(/,/g, "")) || 0,
            subtotal: parseInt(match[8].replace(/,/g, "")) || 0,
        });
    }

    // Fallback: token-based parsing if regex fails
    if (results.length === 0) {
        const tokens = fullText.split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
            if (!/^\d{6}$/.test(tokens[i])) continue;
            const hinban = tokens[i];

            let nameTokens: string[] = [];
            let j = i + 1;
            while (j < tokens.length && !tokens[j].startsWith("4970974")) {
                nameTokens.push(tokens[j]);
                j++;
            }
            if (j >= tokens.length) continue;

            let janTokens: string[] = [];
            while (j < tokens.length) {
                const cleaned = tokens[j].replace(/[\s\-‐‑‒–—―ー－]/g, "");
                if (/^\d+$/.test(cleaned) || tokens[j].startsWith("4970974")) {
                    janTokens.push(tokens[j]);
                    j++;
                    if (normalizeJan(janTokens.join("")).length >= 13) break;
                } else break;
            }
            const janCode = normalizeJan(janTokens.join(""));

            let quantity = 0, unitPrice = 0, subtotal = 0;
            for (let k = j; k < Math.min(j + 12, tokens.length); k++) {
                const costMatch = tokens[k].match(/^[¥￥]([\d,]+)$/);
                if (costMatch && unitPrice === 0) {
                    unitPrice = parseInt(costMatch[1].replace(/,/g, "")) || 0;
                    if (k + 1 < tokens.length && /^\d+$/.test(tokens[k + 1])) {
                        quantity = parseInt(tokens[k + 1]) || 0;
                    }
                } else if (costMatch && unitPrice > 0 && k > j + 3) {
                    subtotal = parseInt(costMatch[1].replace(/,/g, "")) || 0;
                }
            }

            if (janCode.length >= 7 && quantity > 0) {
                results.push({
                    hinban,
                    productName: nameTokens.join(" ").trim(),
                    janCode: janCode.substring(0, 13),
                    spec: "",
                    quantity, unitPrice, subtotal,
                });
            }
        }
    }

    return results;
}

/**
 * parseCorecPDF — コレックPDFバッファを受け取り、商品行をパースして返す
 * pdf-parse でテキスト抽出 → 品番(6桁)開始行を検出 → JAN正規化 → 数量抽出
 */
async function parseCorecPDF(buffer: Buffer): Promise<Array<{
    hinban: string; productName: string; janCode: string;
    quantity: number; unitPrice: number;
}>> {
    const pageTexts = await extractPdfText(buffer);
    const lines = parseCorecLines(pageTexts);
    return lines.map((l) => ({
        hinban: l.hinban,
        productName: l.productName,
        janCode: l.janCode,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
    }));
}

purchaseImportRouter.post("/corec/parse", upload.single("file"), async (req: any, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "PDFファイルがアップロードされていません" });
    }

    try {
        const parsed = await parseCorecPDF(req.file.buffer);

        if (parsed.length === 0) {
            const pageTexts = await extractPdfText(req.file.buffer);
            return res.status(400).json({
                error: "PDFから商品データを抽出できませんでした",
                rawText: pageTexts.join("\n").substring(0, 500),
            });
        }

        // マッチング処理してプレビュー用データを生成
        const items = [];
        for (let i = 0; i < parsed.length; i++) {
            const p = parsed[i];
            const product = await prisma.product.findUnique({
                where: { janCode: p.janCode },
                select: { id: true, name: true, janCode: true, currentStock: true },
            });
            items.push({
                row: i + 1,
                hinban: p.hinban,
                productName: p.productName,
                janCode: p.janCode,
                quantity: p.quantity,
                unitPrice: p.unitPrice,
                subtotal: p.quantity * p.unitPrice,
                matched: !!product,
                matchedProductId: product?.id || null,
                matchedProductName: product?.name || null,
                currentStock: product?.currentStock || null,
            });
        }

        res.json({ items });
    } catch (error: any) {
        console.error("COREC parse error:", error);
        res.status(500).json({ error: "PDF解析中にエラーが発生しました: " + (error.message || "") });
    }
});

purchaseImportRouter.post("/corec/confirm", async (req, res) => {
    const userId = (req.session as any).userId;
    const { items, filename } = req.body;
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "確定データがありません" });
    }

    try {
        const now = new Date();

        // CsvImport レコード作成
        const csvImport = await prisma.csvImport.create({
            data: {
                filename: filename || "corec_import.pdf",
                periodStart: now,
                periodEnd: now,
                csvType: "PURCHASE_COREC",
                recordCount: items.length,
                userId,
                status: "COMPLETED",
            },
        });

        let processed = 0;
        let skipped = 0;
        let newlyRegistered = 0;

        for (const item of items) {
            const quantity = item.quantity || 0;
            if (quantity <= 0) {
                skipped++;
                continue;
            }

            let productId = item.matchedProductId;

            // Auto-register unmatched products
            if (!productId && item.autoRegister) {
                const categoryId = await getOrCreateDefaultCategory();
                const janCode = item.janCode || `AUTO_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const newProduct = await prisma.product.upsert({
                    where: { janCode },
                    update: {},
                    create: {
                        name: item.productName || "不明な商品",
                        janCode,
                        categoryId,
                        costPrice: item.unitPrice || 0,
                        sellingPrice: 0,
                        currentStock: 0,
                        supplyType: "OEM",
                    },
                });
                productId = newProduct.id;
                newlyRegistered++;
            }

            if (!productId) {
                skipped++;
                continue;
            }

            // 在庫加算
            const product = await prisma.product.update({
                where: { id: productId },
                data: { currentStock: { increment: quantity } },
            });

            // InventoryTransaction 記録
            await prisma.inventoryTransaction.create({
                data: {
                    productId,
                    type: "PURCHASE_CSV",
                    quantity,
                    stockAfter: product.currentStock,
                    note: `仕入: コレック COREC (${filename || "PDF"})`,
                    userId,
                    csvImportId: csvImport.id,
                },
            });

            // 原価更新
            if (item.unitPrice && item.unitPrice > 0) {
                await prisma.product.update({
                    where: { id: productId },
                    data: { costPrice: item.unitPrice },
                });
            }

            processed++;
        }

        res.json({ success: true, processed, skipped, newlyRegistered });
    } catch (error: any) {
        console.error("COREC confirm error:", error);
        res.status(500).json({ error: "確定処理中にエラーが発生しました: " + (error.message || "") });
    }
});

// ==================================================
//  ジャヌツー JANNU-2 Excel パーサー
// ==================================================

interface JannuSKU {
    design: string;
    modelCode: string;
    color: string;
    size: string;
    quantity: number;
}

/**
 * 商品名 + カラー + サイズの複合条件で検索（JANコードなし）
 * カラーの括弧内数字（086等）を除去してマッチング
 */
async function matchProductByNameColorSize(
    design: string,
    color: string,
    size: string
): Promise<{ id: number; name: string; janCode: string; currentStock: number } | null> {
    // 括弧内のカラーコードを除去: "ネイビー（086）" → "ネイビー"
    const cleanColor = color
        .replace(/[（(][^）)]*[）)]/g, "")
        .trim();

    // 1) 名前 + カラー + サイズで完全マッチ
    const exact = await prisma.product.findFirst({
        where: {
            isActive: true,
            name: { contains: design },
            color: { contains: cleanColor },
            size: size,
        },
        select: { id: true, name: true, janCode: true, currentStock: true },
    });
    if (exact) return exact;

    // 2) 名前 + カラー（サイズ緩く）
    const byNameColor = await prisma.product.findFirst({
        where: {
            isActive: true,
            name: { contains: design },
            color: { contains: cleanColor },
            size: { contains: size },
        },
        select: { id: true, name: true, janCode: true, currentStock: true },
    });
    if (byNameColor) return byNameColor;

    // 3) 商品名にカラーとサイズが含まれるパターン
    const combined = await prisma.product.findFirst({
        where: {
            isActive: true,
            AND: [
                { name: { contains: design } },
                { name: { contains: cleanColor } },
                { name: { contains: size } },
            ],
        },
        select: { id: true, name: true, janCode: true, currentStock: true },
    });
    if (combined) return combined;

    return null;
}

/**
 * parseJannuExcel — ジャヌツーの3Dマトリクス Excel をパース
 * 柄 × カラー × サイズ → SKU 単位に分解
 */
function parseJannuExcel(buffer: Buffer): JannuSKU[] {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    // 最初のシートを使用
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    // シートを2D配列に変換
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
    });

    if (data.length < 3) return [];

    // 2行目がヘッダー（index 1）: 柄, カラー, S, M, L, XL, 2XL, 3XL
    const headerRow = data[1];
    // サイズ列を特定（C列=index 2 以降）
    const sizeColumns: { index: number; size: string }[] = [];
    for (let c = 2; c < headerRow.length; c++) {
        const val = String(headerRow[c] || "").trim();
        if (val && /^(XS|S|M|L|XL|2XL|3XL|4XL|F|FREE)$/i.test(val)) {
            sizeColumns.push({ index: c, size: val.toUpperCase() });
        }
    }

    const results: JannuSKU[] = [];
    let currentDesign = "";
    let currentModelCode = "";

    // 3行目以降がデータ（index 2〜）
    for (let r = 2; r < data.length; r++) {
        const row = data[r];
        const cellA = String(row[0] || "").trim();
        const cellB = String(row[1] || "").trim();

        // A列に値がある → 新しい柄
        if (cellA) {
            // セル内改行で柄名と型番を分離
            const parts = cellA.split(/\r?\n/);
            currentDesign = parts[0].trim();
            currentModelCode = parts.length > 1 ? parts[1].trim() : "";
        }

        // B列が空 or 柄名がない → スキップ（ヘッダーや合計行）
        if (!cellB || !currentDesign) continue;

        // 合計行をスキップ（"合計", "TOTAL", etc.）
        if (/^(合計|小計|TOTAL|計)/i.test(cellB)) continue;

        const color = cellB;

        // 各サイズ列の数量を読み取り
        for (const sc of sizeColumns) {
            const rawVal = row[sc.index];
            const quantity = typeof rawVal === "number"
                ? rawVal
                : parseInt(String(rawVal).replace(/,/g, "")) || 0;

            if (quantity > 0) {
                results.push({
                    design: currentDesign,
                    modelCode: currentModelCode,
                    color,
                    size: sc.size,
                    quantity,
                });
            }
        }
    }

    return results;
}

// --- Jannu Parse endpoint ---
purchaseImportRouter.post("/jannu/parse", upload.single("file"), async (req: any, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Excelファイルがアップロードされていません" });
    }

    try {
        const skus = parseJannuExcel(req.file.buffer);

        if (skus.length === 0) {
            return res.status(400).json({
                error: "Excelから商品データを抽出できませんでした。シートのフォーマットを確認してください。",
            });
        }

        // マッチング処理（SupplierProductMapping → matchProductByNameColorSize の順で参照）
        const items = [];
        for (let i = 0; i < skus.length; i++) {
            const sku = skus[i];
            const supplierProductName = [sku.design, sku.color, sku.size].filter(Boolean).join(" ");

            // 1) 保存済みマッピングを優先参照
            const savedMapping = await prisma.supplierProductMapping.findUnique({
                where: {
                    supplierName_supplierProductName: {
                        supplierName: "JANNU",
                        supplierProductName,
                    },
                },
                include: {
                    product: { select: { id: true, name: true, currentStock: true } },
                },
            });

            // 2) マッピングがなければ既存のファジーマッチ
            const product = savedMapping
                ? savedMapping.product
                : await matchProductByNameColorSize(sku.design, sku.color, sku.size);

            items.push({
                row: i + 1,
                design: sku.design,
                modelCode: sku.modelCode,
                color: sku.color,
                size: sku.size,
                quantity: sku.quantity,
                supplierProductName,
                matched: !!product,
                matchedProductId: product?.id || null,
                matchedProductName: product?.name || null,
                currentStock: product?.currentStock || null,
            });
        }

        res.json({ items });
    } catch (error: any) {
        console.error("Jannu parse error:", error);
        res.status(500).json({ error: "Excel解析中にエラーが発生しました: " + (error.message || "") });
    }
});

// --- Jannu Confirm endpoint ---
purchaseImportRouter.post("/jannu/confirm", async (req, res) => {
    const userId = (req.session as any).userId;
    const { items, filename, mappings } = req.body;
    if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "確定データがありません" });
    }

    try {
        const now = new Date();

        const csvImport = await prisma.csvImport.create({
            data: {
                filename: filename || "jannu_import.xlsx",
                periodStart: now,
                periodEnd: now,
                csvType: "PURCHASE_JANNU",
                recordCount: items.length,
                userId,
                status: "COMPLETED",
            },
        });

        let processed = 0;
        let skipped = 0;
        let newlyRegistered = 0;

        for (const item of items) {
            const quantity = item.quantity || 0;
            if (quantity <= 0) {
                skipped++;
                continue;
            }

            let productId = item.matchedProductId;

            // Auto-register unmatched products
            if (!productId && item.autoRegister) {
                const categoryId = await getOrCreateDefaultCategory();
                const productName = [item.design, item.color, item.size].filter(Boolean).join(" ");
                const janCode = `AUTO_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const newProduct = await prisma.product.upsert({
                    where: { janCode },
                    update: {},
                    create: {
                        name: productName || "不明な商品",
                        janCode,
                        categoryId,
                        costPrice: 0,
                        sellingPrice: 0,
                        currentStock: 0,
                        color: item.color || null,
                        size: item.size || null,
                        supplyType: "OEM",
                    },
                });
                productId = newProduct.id;
                newlyRegistered++;
            }

            if (!productId) {
                skipped++;
                continue;
            }

            const product = await prisma.product.update({
                where: { id: productId },
                data: { currentStock: { increment: quantity } },
            });

            await prisma.inventoryTransaction.create({
                data: {
                    productId,
                    type: "PURCHASE_CSV",
                    quantity,
                    stockAfter: product.currentStock,
                    note: `仕入: ジャヌツー (${filename || "Excel"})`,
                    userId,
                    csvImportId: csvImport.id,
                },
            });

            processed++;
        }

        // SupplierProductMapping を upsert 保存（次回以降の自動マッチングに使用）
        if (Array.isArray(mappings)) {
            for (const m of mappings) {
                if (!m.supplierProductName || !m.productId) continue;
                await prisma.supplierProductMapping.upsert({
                    where: {
                        supplierName_supplierProductName: {
                            supplierName: "JANNU",
                            supplierProductName: m.supplierProductName,
                        },
                    },
                    update: { productId: m.productId },
                    create: {
                        supplierName: "JANNU",
                        supplierProductName: m.supplierProductName,
                        productId: m.productId,
                    },
                });
            }
        }

        res.json({ success: true, processed, skipped, newlyRegistered });
    } catch (error: any) {
        console.error("Jannu confirm error:", error);
        res.status(500).json({ error: "確定処理中にエラーが発生しました: " + (error.message || "") });
    }
});
