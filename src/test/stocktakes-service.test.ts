// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  completeStocktake,
  computeAdjustment,
  parseActualStockInput,
  STOCKTAKE_ADJUSTMENT_TYPE,
  StocktakeInputError,
} from "../../server/stocktakes-service";

describe("stocktake calculation", () => {
  it("uses live stock, not theoretical stock, for the audit adjustment", () => {
    expect(computeAdjustment(8, 10)).toEqual({ newStock: 8, adjustmentQuantity: -2 });
    expect(computeAdjustment(8, 7)).toEqual({ newStock: 8, adjustmentQuantity: 1 });
  });

  it("keeps multiple rows independent", () => {
    const rows = [
      computeAdjustment(8, 7),
      computeAdjustment(3, 5),
    ];

    expect(rows).toEqual([
      { newStock: 8, adjustmentQuantity: 1 },
      { newStock: 3, adjustmentQuantity: -2 },
    ]);
  });
});

describe("stocktake actual stock input parsing", () => {
  it("accepts blank as null and normalizes full-width integer input", () => {
    expect(parseActualStockInput("")).toBeNull();
    expect(parseActualStockInput(" ８ ")).toBe(8);
  });

  it("rejects decimal and non-numeric input", () => {
    expect(() => parseActualStockInput("8.5")).toThrow(StocktakeInputError);
    expect(() => parseActualStockInput("abc")).toThrow(StocktakeInputError);
  });
});

describe("completeStocktake integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-stocktake-"));
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

  it("sets currentStock to actualStock, records live-stock adjustments once, and is idempotent", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Stocktake Tester",
        email: "stocktake-tester@example.com",
        passwordHash: "test",
        role: "ADMIN",
      },
    });
    const category = await prisma.category.create({
      data: { name: "test-category", displayName: "テスト", department: "FOOD" },
    });

    const movingProduct = await prisma.product.create({
      data: {
        janCode: "4900000000011",
        name: "棚卸し中に動いた商品",
        categoryId: category.id,
        currentStock: 10,
      },
    });
    const unchangedProduct = await prisma.product.create({
      data: {
        janCode: "4900000000028",
        name: "補正不要の商品",
        categoryId: category.id,
        currentStock: 4,
      },
    });
    const inboundProduct = await prisma.product.create({
      data: {
        janCode: "4900000000035",
        name: "直前入庫があった商品",
        categoryId: category.id,
        currentStock: 1,
      },
    });

    const stocktake = await prisma.stocktake.create({
      data: {
        stocktakeDate: new Date("2026-01-01T00:00:00.000Z"),
        userId: user.id,
        totalProducts: 3,
      },
    });
    await prisma.inventoryCount.createMany({
      data: [
        {
          stocktakeId: stocktake.id,
          productId: movingProduct.id,
          theoreticalStock: 10,
          actualStock: 8,
          discrepancy: -2,
        },
        {
          stocktakeId: stocktake.id,
          productId: unchangedProduct.id,
          theoreticalStock: 4,
          actualStock: 4,
          discrepancy: 0,
        },
        {
          stocktakeId: stocktake.id,
          productId: inboundProduct.id,
          theoreticalStock: 1,
          actualStock: 0,
          discrepancy: -1,
        },
      ],
    });

    await prisma.$transaction([
      prisma.product.update({ where: { id: movingProduct.id }, data: { currentStock: 12 } }),
      prisma.inventoryTransaction.create({
        data: {
          productId: movingProduct.id,
          type: "PURCHASE",
          quantity: 2,
          stockAfter: 12,
          userId: user.id,
        },
      }),
      prisma.product.update({ where: { id: movingProduct.id }, data: { currentStock: 7 } }),
      prisma.inventoryTransaction.create({
        data: {
          productId: movingProduct.id,
          type: "SALE_CSV",
          quantity: -5,
          stockAfter: 7,
          userId: user.id,
        },
      }),
      prisma.product.update({ where: { id: inboundProduct.id }, data: { currentStock: 3 } }),
      prisma.inventoryTransaction.create({
        data: {
          productId: inboundProduct.id,
          type: "PURCHASE",
          quantity: 2,
          stockAfter: 3,
          userId: user.id,
        },
      }),
    ]);

    const completed = await completeStocktake(prisma, stocktake.id, user.id);

    expect(completed).toMatchObject({
      success: true,
      discrepancyCount: 2,
      alreadyCompleted: false,
      adjustmentsCreated: 2,
    });

    const productsAfter = await prisma.product.findMany({ orderBy: { id: "asc" } });
    expect(productsAfter.map((product) => product.currentStock)).toEqual([8, 4, 0]);

    const adjustments = await prisma.inventoryTransaction.findMany({
      where: { type: STOCKTAKE_ADJUSTMENT_TYPE },
      orderBy: { productId: "asc" },
    });
    expect(adjustments).toHaveLength(2);
    expect(adjustments.map((transaction) => ({
      productId: transaction.productId,
      quantity: transaction.quantity,
      stockAfter: transaction.stockAfter,
      type: transaction.type,
    }))).toEqual([
      {
        productId: movingProduct.id,
        quantity: 1,
        stockAfter: 8,
        type: STOCKTAKE_ADJUSTMENT_TYPE,
      },
      {
        productId: inboundProduct.id,
        quantity: -3,
        stockAfter: 0,
        type: STOCKTAKE_ADJUSTMENT_TYPE,
      },
    ]);
    expect(7 + adjustments[0].quantity).toBe(adjustments[0].stockAfter);
    expect(3 + adjustments[1].quantity).toBe(adjustments[1].stockAfter);

    const second = await completeStocktake(prisma, stocktake.id, user.id);
    const adjustmentsAfterSecondRun = await prisma.inventoryTransaction.count({
      where: { type: STOCKTAKE_ADJUSTMENT_TYPE },
    });
    const productsAfterSecondRun = await prisma.product.findMany({ orderBy: { id: "asc" } });

    expect(second.alreadyCompleted).toBe(true);
    expect(adjustmentsAfterSecondRun).toBe(adjustments.length);
    expect(productsAfterSecondRun.map((product) => product.currentStock)).toEqual([8, 4, 0]);
  });
});

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
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE stocktakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stocktake_date DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      total_products INTEGER NOT NULL DEFAULT 0,
      discrepancy_count INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE inventory_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stocktake_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      theoretical_stock INTEGER NOT NULL,
      actual_stock INTEGER,
      discrepancy INTEGER,
      reason TEXT NOT NULL DEFAULT 'NONE',
      note TEXT,
      FOREIGN KEY (stocktake_id) REFERENCES stocktakes(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`,
    `CREATE UNIQUE INDEX inventory_counts_stocktake_id_product_id_key
      ON inventory_counts(stocktake_id, product_id)`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
