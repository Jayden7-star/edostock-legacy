// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { importProductSales } from "../../server/csv-sales-service";

// P1: 売上CSV（PRODUCT_SALES）確定処理で、在庫減算・inventory_transactions 作成・
// sales_records 作成・csvImport.status=COMPLETED 更新が「同一 $transaction」に収まり、
// 途中失敗時にすべてロールバックされること、PENDINGゴーストが削除されることを一時SQLiteで証明する。
// dev.db / production.db / schema.prisma / migration には一切触れない。

const PERIOD_START = "2026-01-01T00:00:00.000Z";
const PERIOD_END = "2026-01-31T23:59:59.000Z";

describe("importProductSales (PRODUCT_SALES 確定 / $transaction)", () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    let tempDir = "";
    let prisma: PrismaClient;
    let userId = 0;
    let categoryId = 0;

    beforeAll(async () => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-csv-sales-"));
        const databaseUrl = `file:${path.join(tempDir, "test.db")}`;
        process.env.DATABASE_URL = databaseUrl;
        prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        await createTemporarySchema(prisma);
    });

    afterAll(async () => {
        await prisma?.$disconnect();
        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    // 各テストはクリーンな状態から始める（子→親の順で削除）
    beforeEach(async () => {
        await prisma.inventoryTransaction.deleteMany();
        await prisma.salesRecord.deleteMany();
        await prisma.discountRecord.deleteMany();
        await prisma.csvImport.deleteMany();
        await prisma.product.deleteMany();
        await prisma.category.deleteMany();
        await prisma.user.deleteMany();

        const user = await prisma.user.create({
            data: { name: "CSV Tester", email: "csv-tester@example.com", passwordHash: "test", role: "ADMIN" },
        });
        userId = user.id;
        const category = await prisma.category.create({
            data: { name: "食品", displayName: "食品", department: "FOOD" },
        });
        categoryId = category.id;
    });

    const makeProduct = (jan: string, name: string, currentStock: number) =>
        prisma.product.create({ data: { janCode: jan, name, categoryId, currentStock } });

    const salesRow = (jan: string, name: string, qty: number, net: number) => ({
        商品コード: jan,
        商品名: name,
        数量: String(qty),
        値引き後計: String(net),
        部門名: "食品",
    });

    it("成功時: 在庫を減算し inventory_transactions / sales_records を作り status=COMPLETED にする", async () => {
        const product = await makeProduct("4900000000011", "昆布", 10);

        const result = await importProductSales(
            prisma,
            {
                records: [salesRow("4900000000011", "昆布", 3, 1500)],
                filename: "sales-ok.csv",
                periodStart: PERIOD_START,
                periodEnd: PERIOD_END,
                overrideMap: new Map(),
            },
            userId
        );

        expect(result).toEqual({ importId: expect.any(Number), recordCount: 1, autoCreatedCount: 0 });

        // 在庫が 10 → 7 に減算されている
        const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        expect(after.currentStock).toBe(7);

        // inventory_transactions に SALE_CSV が1件
        const txs = await prisma.inventoryTransaction.findMany({ where: { productId: product.id } });
        expect(txs).toHaveLength(1);
        expect({ type: txs[0].type, quantity: txs[0].quantity, stockAfter: txs[0].stockAfter, csvImportId: txs[0].csvImportId }).toEqual({
            type: "SALE_CSV",
            quantity: 3,
            stockAfter: 7,
            csvImportId: result.importId,
        });

        // sales_records が1件
        expect(await prisma.salesRecord.count({ where: { csvImportId: result.importId } })).toBe(1);

        // csv_imports が COMPLETED（再取込を弾く正しい状態）
        const csvImport = await prisma.csvImport.findUniqueOrThrow({ where: { id: result.importId } });
        expect(csvImport.status).toBe("COMPLETED");
    });

    it("status更新失敗時(=このP1の核心): 在庫もinventory_transactions/sales_recordsもロールバックされ、PENDINGゴーストは削除される", async () => {
        const product = await makeProduct("4900000000011", "昆布", 10);

        // status=COMPLETED 更新（トップレベルの csvImport.update も $transaction 内の tx.csvImport.update も）を
        // 失敗させる prisma を注入する。修正後は更新が $transaction の最後にあるため tx 側が throw → 全ロールバック。
        // もし将来 status更新を $transaction の外へ戻す(=バグ再発)と、ループtxがコミット後にトップレベル update が
        // throw し、在庫が減ったまま残る → 下の currentStock===10 アサートが落ちて回帰を検知する。
        const faultyDb = makeStatusUpdateFailingClient(prisma);

        await expect(
            importProductSales(
                faultyDb,
                {
                    records: [salesRow("4900000000011", "昆布", 3, 1500)],
                    filename: "sales-status-fail.csv",
                    periodStart: PERIOD_START,
                    periodEnd: PERIOD_END,
                    overrideMap: new Map(),
                },
                userId
            )
        ).rejects.toThrow(/csvImport\.update failed/);

        // 1. 在庫が減っていない（10 のまま）
        const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        expect(after.currentStock).toBe(10);

        // 2. inventory_transactions が残っていない
        expect(await prisma.inventoryTransaction.count()).toBe(0);

        // 3. sales_records / discount_records が残っていない
        expect(await prisma.salesRecord.count()).toBe(0);
        expect(await prisma.discountRecord.count()).toBe(0);

        // 4. csv_imports のゴーストが残らない（子行がロールバック済みのため delete が成功する設計）
        expect(await prisma.csvImport.count()).toBe(0);
        // 念のため: PENDING の残骸が再取込を妨げる不整合として残っていないこと
        expect(await prisma.csvImport.count({ where: { status: "PENDING" } })).toBe(0);
    });

    it("ループ途中失敗時: 先に処理した行の在庫減算も含め全ロールバックされ、ゴーストが削除される", async () => {
        // 1件目: 正常に在庫が減るはずの商品（10 → 7）
        const product = await makeProduct("4900000000011", "昆布", 10);

        // 2件目: DBに無いJAN + 存在しない existingProductId への override
        //   → tx.product.update({ id: 999999 }) が P2025 で失敗し $transaction がロールバックする
        const overrideMap = new Map([
            ["9999999999999", { csvProductName: "幽霊商品", existingProductId: 999999 }],
        ]);

        await expect(
            importProductSales(
                prisma,
                {
                    records: [
                        salesRow("4900000000011", "昆布", 3, 1500),
                        salesRow("9999999999999", "幽霊商品", 1, 500),
                    ],
                    filename: "sales-loop-fail.csv",
                    periodStart: PERIOD_START,
                    periodEnd: PERIOD_END,
                    overrideMap,
                },
                userId
            )
        ).rejects.toBeTruthy();

        // 1件目の在庫減算もロールバックされている（10 のまま）
        const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
        expect(after.currentStock).toBe(10);
        expect(await prisma.inventoryTransaction.count()).toBe(0);
        expect(await prisma.salesRecord.count()).toBe(0);
        // ゴースト（PENDING）が削除されている
        expect(await prisma.csvImport.count()).toBe(0);
    });
});

/**
 * csvImport.update（トップレベル prisma.csvImport.update と $transaction 内 tx.csvImport.update の両方）を
 * 必ず throw させる PrismaClient プロキシ。create / delete / その他は素通し。新規パッケージ不要の純JS Proxy。
 */
function makeStatusUpdateFailingClient(real: PrismaClient): PrismaClient {
    const failUpdate = () => {
        throw new Error("injected: csvImport.update failed");
    };
    const wrapCsvImport = (delegate: any) =>
        new Proxy(delegate, {
            get(target, prop, receiver) {
                if (prop === "update") return failUpdate;
                return Reflect.get(target, prop, receiver);
            },
        });
    const wrapTx = (tx: any) =>
        new Proxy(tx, {
            get(target, prop, receiver) {
                if (prop === "csvImport") return wrapCsvImport(target.csvImport);
                return Reflect.get(target, prop, receiver);
            },
        });
    return new Proxy(real, {
        get(target, prop, receiver) {
            if (prop === "csvImport") return wrapCsvImport((target as any).csvImport);
            if (prop === "$transaction") {
                return (cb: any, opts: any) => {
                    if (typeof cb === "function") {
                        return (target as any).$transaction((tx: any) => cb(wrapTx(tx)), opts);
                    }
                    return (target as any).$transaction(cb, opts);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    }) as unknown as PrismaClient;
}

async function createTemporarySchema(prisma: PrismaClient) {
    const statements = [
        `CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STAFF',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
        `CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_food BOOLEAN NOT NULL DEFAULT false,
      department TEXT NOT NULL DEFAULT 'FOOD',
      display_order INTEGER NOT NULL DEFAULT 0
    )`,
        `CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jan_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      color TEXT,
      size TEXT,
      category_id INTEGER NOT NULL,
      cost_price INTEGER NOT NULL DEFAULT 0,
      selling_price INTEGER NOT NULL DEFAULT 0,
      current_stock INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 0,
      optimal_stock INTEGER NOT NULL DEFAULT 0,
      optimal_stock_01 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_02 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_03 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_04 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_05 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_06 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_07 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_08 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_09 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_10 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_11 INTEGER NOT NULL DEFAULT 0,
      optimal_stock_12 INTEGER NOT NULL DEFAULT 0,
      supplyType TEXT NOT NULL DEFAULT 'PURCHASED',
      sales_type TEXT NOT NULL DEFAULT 'REGULAR',
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_auto_created BOOLEAN NOT NULL DEFAULT false,
      needs_review BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`,
        `CREATE TABLE csv_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      csv_type TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
        `CREATE TABLE inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      stock_after INTEGER NOT NULL,
      note TEXT,
      user_id INTEGER NOT NULL,
      csv_import_id INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (csv_import_id) REFERENCES csv_imports(id)
    )`,
        `CREATE TABLE sales_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      csv_import_id INTEGER NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      quantity_sold INTEGER NOT NULL,
      net_sales INTEGER NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (csv_import_id) REFERENCES csv_imports(id)
    )`,
        `CREATE TABLE discount_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      csv_import_id INTEGER NOT NULL,
      record_type TEXT NOT NULL,
      item_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      transaction_id TEXT,
      transaction_date DATETIME,
      bundle_group_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (csv_import_id) REFERENCES csv_imports(id)
    )`,
    ];

    for (const statement of statements) {
        await prisma.$executeRawUnsafe(statement);
    }
}
