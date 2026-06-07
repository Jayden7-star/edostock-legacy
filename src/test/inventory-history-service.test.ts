// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  getProductTransactions,
  ProductNotFoundError,
  CLAMP_NOTE_MARKER,
} from "../../server/inventory-history-service";

describe("getProductTransactions integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;
  let userId = 0;
  let categoryId = 0;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-history-"));
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
    await prisma.csvImport.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.category.deleteMany();

    const user = await prisma.user.create({
      data: { name: "History Tester", email: "history-tester@example.com", passwordHash: "test", role: "STAFF" },
    });
    userId = user.id;
    const category = await prisma.category.create({
      data: { name: "test-category", displayName: "テスト", department: "FOOD" },
    });
    categoryId = category.id;
  });

  const makeProduct = (jan: string, name: string, currentStock: number) =>
    prisma.product.create({ data: { janCode: jan, name, categoryId, currentStock } });

  const makeTx = (
    productId: number,
    type: string,
    quantity: number,
    stockAfter: number,
    extra: { note?: string | null; csvImportId?: number; createdAt?: Date } = {}
  ) =>
    prisma.inventoryTransaction.create({
      data: { productId, type, quantity, stockAfter, userId, ...extra },
    });

  it("returns an empty list and total 0 for a product with no transactions", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);

    const result = await getProductTransactions(prisma, p.id);

    expect(result.transactions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.product).toMatchObject({
      id: p.id,
      name: "昆布",
      janCode: "4900000000011",
      currentStock: 10,
    });
  });

  it("orders newest-first by id desc, ignoring created_at", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);

    // 最初に挿入 = 最小 id。だが created_at は最も新しい(2999年)。
    // created_at 基準なら先頭に来るはずだが、id 基準では末尾に来なければならない。
    const firstInsertedNewestTime = await makeTx(p.id, "PURCHASE", 10, 10, {
      createdAt: new Date("2999-01-01T00:00:00Z"),
    });
    const second = await makeTx(p.id, "SALE_CSV", 3, 7, { createdAt: new Date("2000-01-01T00:00:00Z") });
    const third = await makeTx(p.id, "ADJUSTMENT", -1, 6, { createdAt: new Date("2010-01-01T00:00:00Z") });

    const result = await getProductTransactions(prisma, p.id);

    expect(result.transactions.map((t) => t.id)).toEqual([
      third.id,
      second.id,
      firstInsertedNewestTime.id,
    ]);
    expect(result.total).toBe(3);
  });

  it("does not break on a legacy TEXT created_at row and still orders by id", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);
    const normal = await makeTx(p.id, "PURCHASE", 10, 10);
    // 過去に Prisma を介さない raw SQL で混入した TEXT 形式の created_at を直接挿入（id は normal より大きい）
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory_transactions (product_id, type, quantity, stock_after, note, user_id, created_at)
       VALUES (?, 'ADJUSTMENT', -2, 8, NULL, ?, '2026-04-11 23:44:48')`,
      p.id,
      userId
    );

    const result = await getProductTransactions(prisma, p.id);

    expect(result.total).toBe(2);
    // id 降順: 後挿入の TEXT 行が先頭、normal が後
    expect(result.transactions[0].stockAfter).toBe(8);
    expect(result.transactions[0].createdAt).toBeInstanceOf(Date);
    expect(result.transactions[1].id).toBe(normal.id);
  });

  it("derives isClamped from the note clamp marker (null-safe)", async () => {
    const p = await makeProduct("4900000000011", "昆布", 0);
    await makeTx(p.id, "SALE_CSV", 5, 0, { note: `売上CSV: a.csv ⚠️ ${CLAMP_NOTE_MARKER}` });
    await makeTx(p.id, "PURCHASE", 3, 3, { note: "通常入庫" });
    await makeTx(p.id, "ADJUSTMENT", -1, 2, { note: null });

    const result = await getProductTransactions(prisma, p.id);
    const byType = Object.fromEntries(result.transactions.map((t) => [t.type, t.isClamped]));

    expect(byType.SALE_CSV).toBe(true);
    expect(byType.PURCHASE).toBe(false);
    expect(byType.ADJUSTMENT).toBe(false);
  });

  it("filters by transaction type and reports the filtered total", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);
    await makeTx(p.id, "PURCHASE", 10, 10);
    await makeTx(p.id, "SALE_CSV", 3, 7);
    await makeTx(p.id, "SALE_CSV", 2, 5);

    const result = await getProductTransactions(prisma, p.id, { type: "SALE_CSV" });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.type === "SALE_CSV")).toBe(true);
    expect(result.total).toBe(2);
  });

  it("applies limit/offset and reports the unpaged total", async () => {
    const p = await makeProduct("4900000000011", "昆布", 100);
    for (let i = 0; i < 5; i++) {
      await makeTx(p.id, "PURCHASE", 1, i + 1);
    }

    const firstPage = await getProductTransactions(prisma, p.id, { limit: 2, offset: 0 });
    expect(firstPage.transactions).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.limit).toBe(2);
    expect(firstPage.offset).toBe(0);

    const secondPage = await getProductTransactions(prisma, p.id, { limit: 2, offset: 2 });
    expect(secondPage.transactions).toHaveLength(2);
    // 別ページは重複しない（id 降順で連続スライス）
    const firstIds = new Set(firstPage.transactions.map((t) => t.id));
    expect(secondPage.transactions.some((t) => firstIds.has(t.id))).toBe(false);
  });

  it("throws ProductNotFoundError for a missing product", async () => {
    await expect(getProductTransactions(prisma, 999999)).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(getProductTransactions(prisma, 999999)).rejects.toMatchObject({
      code: "PRODUCT_NOT_FOUND",
    });
  });

  it("hydrates the csvImport relation when present, null otherwise", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);
    const csvImport = await prisma.csvImport.create({
      data: {
        filename: "sales-2026-06-07.csv",
        periodStart: new Date("2026-06-01T00:00:00Z"),
        periodEnd: new Date("2026-06-07T00:00:00Z"),
        csvType: "PRODUCT_SALES",
        recordCount: 1,
        userId,
        status: "COMPLETED",
      },
    });
    await makeTx(p.id, "SALE_CSV", 3, 7, { csvImportId: csvImport.id });
    await makeTx(p.id, "PURCHASE", 10, 10);

    const result = await getProductTransactions(prisma, p.id);
    const sale = result.transactions.find((t) => t.type === "SALE_CSV");
    const purchase = result.transactions.find((t) => t.type === "PURCHASE");

    expect(sale?.csvImport).toMatchObject({
      filename: "sales-2026-06-07.csv",
      csvType: "PRODUCT_SALES",
    });
    expect(purchase?.csvImport).toBeNull();
  });

  it("includes the user relation", async () => {
    const p = await makeProduct("4900000000011", "昆布", 10);
    await makeTx(p.id, "PURCHASE", 10, 10);

    const result = await getProductTransactions(prisma, p.id);

    expect(result.transactions[0].user).toMatchObject({ id: userId, name: "History Tester" });
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
    // csvImport リレーション（include: { csvImport }）を検証するため csv_imports が必須。
    `CREATE TABLE csv_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      csv_type TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      content_hash TEXT,
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
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
