// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  batchAdjustInventory,
  parseBatchActualStock,
  InventoryAdjustInputError,
  InventoryAdjustServiceError,
  MANUAL_ADJUSTMENT_TYPE,
} from "../../server/inventory-adjust-service";

describe("parseBatchActualStock", () => {
  it("accepts 0 and normalizes full-width integers", () => {
    expect(parseBatchActualStock(0)).toBe(0);
    expect(parseBatchActualStock("0")).toBe(0);
    expect(parseBatchActualStock(" ４３ ")).toBe(43);
    expect(parseBatchActualStock(43)).toBe(43);
  });

  it("rejects blank, negative, decimal and non-numeric input", () => {
    expect(() => parseBatchActualStock("")).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock("   ")).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock(null)).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock(undefined)).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock("-1")).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock(-1)).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock("4.5")).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock(4.5)).toThrow(InventoryAdjustInputError);
    expect(() => parseBatchActualStock("abc")).toThrow(InventoryAdjustInputError);
  });
});

describe("batchAdjustInventory integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;
  let userId = 0;
  let categoryId = 0;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-batch-adjust-"));
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
      data: { name: "Batch Tester", email: "batch-tester@example.com", passwordHash: "test", role: "STAFF" },
    });
    userId = user.id;
    const category = await prisma.category.create({
      data: { name: "test-category", displayName: "テスト", department: "FOOD" },
    });
    categoryId = category.id;
  });

  const makeProduct = (jan: string, name: string, currentStock: number) =>
    prisma.product.create({ data: { janCode: jan, name, categoryId, currentStock } });

  it("updates multiple products in one batch and records adjustments", async () => {
    const a = await makeProduct("4900000000011", "商品A", 45);
    const b = await makeProduct("4900000000028", "商品B", 10);

    const result = await batchAdjustInventory(
      prisma,
      [
        { productId: a.id, actualStock: 43, note: "棚卸し補正" },
        { productId: b.id, actualStock: 15 },
      ],
      userId
    );

    expect(result.adjustmentsCreated).toBe(2);
    expect(result.updated).toEqual([
      { id: a.id, currentStock: 43 },
      { id: b.id, currentStock: 15 },
    ]);

    const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
    expect(products.map((p) => p.currentStock)).toEqual([43, 15]);

    const txs = await prisma.inventoryTransaction.findMany({ orderBy: { productId: "asc" } });
    expect(txs).toHaveLength(2);
    expect(txs.map((t) => ({ productId: t.productId, type: t.type, quantity: t.quantity, stockAfter: t.stockAfter, note: t.note }))).toEqual([
      { productId: a.id, type: MANUAL_ADJUSTMENT_TYPE, quantity: -2, stockAfter: 43, note: "棚卸し補正" },
      { productId: b.id, type: MANUAL_ADJUSTMENT_TYPE, quantity: 5, stockAfter: 15, note: null },
    ]);
  });

  it("saves actualStock = 0 (out of stock)", async () => {
    const a = await makeProduct("4900000000011", "在庫ゼロにする商品", 3);

    const result = await batchAdjustInventory(prisma, [{ productId: a.id, actualStock: 0 }], userId);

    expect(result.adjustmentsCreated).toBe(1);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(0);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { productId: a.id } });
    expect(tx.quantity).toBe(-3);
    expect(tx.stockAfter).toBe(0);
  });

  it("computes the adjustment from the live currentStock at save time, not a stale before value", async () => {
    const a = await makeProduct("4900000000011", "保存直前に動いた商品", 10);

    // フロントが在庫10を見た後、別経路で在庫が7に動いたと想定
    await prisma.product.update({ where: { id: a.id }, data: { currentStock: 7 } });

    // ユーザーの最終実在庫入力は 8
    const result = await batchAdjustInventory(prisma, [{ productId: a.id, actualStock: 8 }], userId);

    expect(result.adjustmentsCreated).toBe(1);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { productId: a.id } });
    // live(7) から計算: 8 - 7 = 1（10 基準の -2 ではない）
    expect(tx.quantity).toBe(1);
    expect(tx.stockAfter).toBe(8);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(8);
  });

  it("does not create an inventory_transaction when adjustmentQuantity is 0", async () => {
    const a = await makeProduct("4900000000011", "差分なしの商品", 5);
    const b = await makeProduct("4900000000028", "差分ありの商品", 5);

    const result = await batchAdjustInventory(
      prisma,
      [
        { productId: a.id, actualStock: 5 }, // 差分0
        { productId: b.id, actualStock: 8 }, // 差分+3
      ],
      userId
    );

    expect(result.adjustmentsCreated).toBe(1);
    const txs = await prisma.inventoryTransaction.findMany();
    expect(txs).toHaveLength(1);
    expect(txs[0].productId).toBe(b.id);
    // 差分0の商品も currentStock は actualStock に確定する（ここでは同値）
    const productA = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(productA.currentStock).toBe(5);
  });

  it("is fail-all: an invalid item rolls back the whole batch (nothing is written)", async () => {
    const a = await makeProduct("4900000000011", "有効な商品", 10);
    const b = await makeProduct("4900000000028", "無効入力の商品", 20);

    await expect(
      batchAdjustInventory(
        prisma,
        [
          { productId: a.id, actualStock: 12 }, // 有効
          { productId: b.id, actualStock: "-1" }, // 無効（負数）
        ],
        userId
      )
    ).rejects.toBeInstanceOf(InventoryAdjustInputError);

    // 検証は書き込み前に行われるため、有効な方も含めて一切変更されない
    const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
    expect(products.map((p) => p.currentStock)).toEqual([10, 20]);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("is fail-all: a missing product rolls back already-applied updates in the same transaction", async () => {
    const a = await makeProduct("4900000000011", "先に処理される有効な商品", 10);
    const missingId = a.id + 9999;

    await expect(
      batchAdjustInventory(
        prisma,
        [
          { productId: a.id, actualStock: 12 }, // 先に更新される
          { productId: missingId, actualStock: 5 }, // 存在しない → throw
        ],
        userId
      )
    ).rejects.toBeInstanceOf(InventoryAdjustServiceError);

    // トランザクションがロールバックされ、先に更新された商品も元に戻る
    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(10);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("rejects a batch containing a duplicate productId before any write (fail-all)", async () => {
    const a = await makeProduct("4900000000011", "重複する商品", 10);
    const b = await makeProduct("4900000000028", "別の商品", 20);

    await expect(
      batchAdjustInventory(
        prisma,
        [
          { productId: a.id, actualStock: 12 },
          { productId: b.id, actualStock: 25 },
          { productId: a.id, actualStock: 8 }, // 同一 productId の重複（後勝ち更新を狙う）
        ],
        userId
      )
    ).rejects.toBeInstanceOf(InventoryAdjustInputError);

    // 在庫は一切変更されない（後勝ち更新も二重 transaction も起きない）
    const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
    expect(products.map((p) => p.currentStock)).toEqual([10, 20]);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("treats a numerically-equal productId (number vs string) as a duplicate", async () => {
    const a = await makeProduct("4900000000011", "数値同一の重複", 10);

    await expect(
      batchAdjustInventory(
        prisma,
        [
          { productId: a.id, actualStock: 12 },
          { productId: String(a.id), actualStock: 8 }, // 文字列だが数値としては同一
        ],
        userId
      )
    ).rejects.toBeInstanceOf(InventoryAdjustInputError);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: a.id } });
    expect(product.currentStock).toBe(10);
    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it("rejects an empty batch", async () => {
    await expect(batchAdjustInventory(prisma, [], userId)).rejects.toBeInstanceOf(InventoryAdjustInputError);
    await expect(batchAdjustInventory(prisma, undefined, userId)).rejects.toBeInstanceOf(InventoryAdjustInputError);
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
