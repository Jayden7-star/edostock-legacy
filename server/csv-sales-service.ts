import type { PrismaClient } from "@prisma/client";

// 売上CSV（PRODUCT_SALES）確定処理の中核を、route handler から切り出した自己完結モジュール。
// prisma を引数で受け取り index.ts に依存しないため、csv.ts ↔ index.ts の循環に巻き込まれない
// （server/inventory-stockin-service.ts の recordStockIn と同じ作法）。
//
// P1: 在庫減算・inventory_transactions 作成・sales_records / discount_records 作成・
// csvImport.status="COMPLETED" 更新を「同一 $transaction」内に収める。これにより、
// 在庫減算が成功した後に status 更新だけ失敗して PENDING ゴーストが残り、
// 重複チェック（status=COMPLETED のみ対象）をすり抜けて再取込・二重減算される窓を塞ぐ。
//
// csvImport の作成のみ $transaction の外（PENDING）。途中失敗時は $transaction 内の書き込みが
// すべてロールバックされるため、catch 側の csvImport.delete() は子行（sales_records /
// inventory_transactions / discount_records）の FK 参照に阻まれず clean に成功する。

export interface ProductSalesMatchOverride {
    csvProductName: string;
    existingProductId: number;
}

export interface ProductSalesImportInput {
    records: any[];
    // Prisma の csv_imports.filename は必須 String。route は req.body 由来の値（any）を渡すため
    // 呼び出し側の型互換は保たれ、ランタイム挙動も従来（undefined ならそのまま Prisma に渡る）と同一。
    filename: string;
    periodStart: string | number | Date;
    periodEnd: string | number | Date;
    overrideMap?: Map<string, ProductSalesMatchOverride>;
}

export interface ProductSalesImportResult {
    importId: number;
    recordCount: number;
    autoCreatedCount: number;
}

/**
 * 売上CSV（PRODUCT_SALES）の確定処理。
 * - 必須列チェック・有効明細チェック・重複チェックは呼び出し側（route）が済ませている前提。
 * - csvImport を PENDING で作成（$transaction 外）。
 * - 明細処理〜在庫減算〜inventory_transactions 作成〜status=COMPLETED 更新を同一 $transaction で実行。
 * - 途中で失敗したら $transaction 全体がロールバックされ、PENDING ゴーストを削除して rethrow する。
 */
export async function importProductSales(
    db: PrismaClient,
    input: ProductSalesImportInput,
    userId: number
): Promise<ProductSalesImportResult> {
    const { records, filename, periodStart, periodEnd } = input;
    const overrideMap = input.overrideMap ?? new Map<string, ProductSalesMatchOverride>();

    // PENDING状態で作成 → トランザクション成功時にCOMPLETEDに更新
    const csvImport = await db.csvImport.create({
        data: {
            filename, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd),
            csvType: "PRODUCT_SALES", recordCount: records.length, userId, status: "PENDING",
        },
    });

    let autoCreatedCount = 0;
    try {
        // P1-1: forループ全体 + COMPLETED更新を prisma.$transaction でラップ
        await db.$transaction(async (tx) => {
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
                                isAutoCreated: true,
                                needsReview: true,
                            },
                        });
                        autoCreatedCount++;
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

            // P1-1: トランザクション成功時のCOMPLETED更新も同一 $transaction の最後に置く。
            // 在庫減算と status 更新が原子的にコミット/ロールバックされ、
            // 「在庫は減ったが PENDING のまま」という再取込・二重減算の窓を塞ぐ。
            await tx.csvImport.update({
                where: { id: csvImport.id },
                data: { status: "COMPLETED" },
            });
        }, { timeout: 30000 });

        return { importId: csvImport.id, recordCount: records.length, autoCreatedCount };
    } catch (txError) {
        // トランザクション失敗 → ゴーストレコード削除
        // $transaction 内の子行はすべてロールバック済みのため、この delete は FK 制約に阻まれず成功する。
        console.error("売上CSVトランザクション失敗、PENDINGレコードを削除:", txError);
        await db.csvImport.delete({ where: { id: csvImport.id } }).catch(() => {});
        throw txError;
    }
}
