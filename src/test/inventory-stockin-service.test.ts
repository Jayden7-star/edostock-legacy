// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  recordStockIn,
  parseStockInQuantity,
  StockInInputError,
  StockInServiceError,
  STOCK_IN_TYPE,
} from "../../server/inventory-stockin-service";

describe("parseStockInQuantity", () => {
  it("accepts positive integers and normalizes full-width digits", () => {
    expect(parseStockInQuantity(1)).toBe(1);
    expect(parseStockInQuantity("1")).toBe(1);
    expect(parseStockInQuantity(" ４３ ")).toBe(43);
    expect(parseStockInQuantity(43)).toBe(43);
  });

  it("rejects 0, blank, negative, decimal, NaN and non-numeric input", () => {
    expect(() => parseStockInQuantity(0)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("0")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("   ")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(null)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(undefined)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(-1)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("-3")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(4.5)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("4.5")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity("abc")).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(NaN)).toThrow(StockInInputError);
    expect(() => parseStockInQuantity(true)).toThrow(StockInInputError);
  });
});

describe("recordStockIn integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;
  let userId = 0;
  let categoryId = 0;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-stockin-"));
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

  // 各テストはクリーンな状態から始める
  beforeEach(async () => {
    await prisma.inventoryTransaction.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.category.deleteMany();

    const user = await prisma.user.create({
      data: { name: "StockIn Tester", email: "stockin-tester@example.com", passwordHash: "test", role: "STAFF" },
    });
    userId = user.id;
    const category = await prisma.category.create({
      data: { name: "test-category", displayName: "テスト", department: "FOOD" },
    });
    categoryId = category.id;
  });

  const makeProduct = (jan: string, name: string, currentStock: number) =>
    prisma.product.create({ data: { janCode: jan, name, categoryId, currentStock } });

  it("adds the inbound quantity to currentStock and records a PURCHASE audit log", async () => {
    const a = await makeProduct("4900000000011", "入庫する商品", 10);

    const result = await recordStockIn(prisma, { productId: a.id, quantity: 5, note: "仕入分" }, userId);

    expect(result).toEqual({ success: true, productId: a.id, quantity: 5, newStock: 15 });

    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(15);

    const txs = await prisma.inventoryTransaction.findMany({ where: { productId: a.id } });
    expect(txs).toHaveLength(1);
    expect({
      type: txs[0].type,
      quantity: txs[0].quantity,
      stockAfter: txs[0].stockAfter,
      note: txs[0].note,
      userId: txs[0].userId,
    }).toEqual({ type: STOCK_IN_TYPE, quantity: 5, stockAfter: 15, note: "仕入分", userId });
  });

  it("accepts full-width / string quantity and stores note as null when blank", async () => {
    const a = await makeProduct("4900000000011", "全角入庫", 10);

    const result = await recordStockIn(prisma, { productId: a.id, quantity: " ５ ", note: "   " }, userId);

    expect(result.newStock).toBe(15);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { productId: a.id } });
    expect(tx.quantity).toBe(5);
    expect(tx.note).toBeNull();
  });

  it("computes newStock from the live currentStock at save time, not a stale before value", async () => {
    const a = await makeProduct("4900000000011", "保存直前に動いた商品", 10);

    // フロントが在庫10を見た後、別経路で在庫が7に動いたと想定
    await prisma.product.update({ where: { id: a.id }, data: { currentStock: 7 } });

    const result = await recordStockIn(prisma, { productId: a.id, quantity: 3 }, userId);

    // live(7) + 3 = 10（10 基準の +3=13 ではない）
    expect(result.newStock).toBe(10);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { productId: a.id } });
    expect(tx.quantity).toBe(3);
    expect(tx.stockAfter).toBe(10);
  });

  it("throws PRODUCT_NOT_FOUND and writes nothing when the product is missing", async () => {
    await expect(
      recordStockIn(prisma, { productId: 999999, quantity: 5 }, userId)
    ).rejects.toBeInstanceOf(StockInServiceError);

    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("rejects invalid quantity before any write (no stock change, no audit log)", async () => {
    const a = await makeProduct("4900000000011", "不正入庫", 10);

    await expect(
      recordStockIn(prisma, { productId: a.id, quantity: "abc" }, userId)
    ).rejects.toBeInstanceOf(StockInInputError);
    await expect(
      recordStockIn(prisma, { productId: a.id, quantity: 0 }, userId)
    ).rejects.toBeInstanceOf(StockInInputError);
    await expect(
      recordStockIn(prisma, { productId: a.id, quantity: -3 }, userId)
    ).rejects.toBeInstanceOf(StockInInputError);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(10);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
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
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
