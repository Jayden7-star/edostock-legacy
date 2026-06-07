// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getAutoCreatedProducts } from "../../server/auto-created-products-service";

describe("getAutoCreatedProducts integration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;
  let userId = 0;
  let categoryId = 0; // FOOD
  let apparelCategoryId = 0; // APPAREL

  const P_START = new Date("2026-06-01T00:00:00Z");
  const P_END = new Date("2026-06-07T00:00:00Z");

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-auto-created-"));
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

  beforeEach(async () => {
    await prisma.salesRecord.deleteMany();
    await prisma.inventoryTransaction.deleteMany();
    await prisma.csvImport.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.category.deleteMany();

    const user = await prisma.user.create({
      data: { name: "Auto Tester", email: "auto-tester@example.com", passwordHash: "test", role: "STAFF" },
    });
    userId = user.id;
    const category = await prisma.category.create({
      data: { name: "test-food", displayName: "食品", department: "FOOD" },
    });
    categoryId = category.id;
    const apparel = await prisma.category.create({
      data: { name: "test-apparel", displayName: "アパレル", department: "APPAREL" },
    });
    apparelCategoryId = apparel.id;
  });

  const makeProduct = (
    jan: string,
    name: string,
    opts: {
      isAutoCreated?: boolean;
      needsReview?: boolean;
      currentStock?: number;
      reorderPoint?: number;
      categoryId?: number;
    } = {}
  ) =>
    prisma.product.create({
      data: {
        janCode: jan,
        name,
        categoryId: opts.categoryId ?? categoryId,
        currentStock: opts.currentStock ?? 0,
        reorderPoint: opts.reorderPoint ?? 0,
        isAutoCreated: opts.isAutoCreated ?? false,
        needsReview: opts.needsReview ?? false,
      },
    });

  const makeCsvImport = (filename: string, csvType: string, importedAt: Date) =>
    prisma.csvImport.create({
      data: {
        filename,
        periodStart: P_START,
        periodEnd: P_END,
        csvType,
        recordCount: 1,
        userId,
        status: "COMPLETED",
        importedAt,
      },
    });

  const makeSalesRecord = (productId: number, csvImportId: number, quantitySold = 1) =>
    prisma.salesRecord.create({
      data: { productId, csvImportId, periodStart: P_START, periodEnd: P_END, quantitySold, netSales: quantitySold * 100 },
    });

  const makeTx = (
    productId: number,
    type: string,
    quantity: number,
    stockAfter: number,
    csvImportId?: number
  ) =>
    prisma.inventoryTransaction.create({
      data: { productId, type, quantity, stockAfter, userId, ...(csvImportId ? { csvImportId } : {}) },
    });

  // 1. 自動作成商品が一覧に出る
  it("includes auto-created products", async () => {
    const p = await makeProduct("4900000000011", "自動商品", { isAutoCreated: true, needsReview: true });

    const result = await getAutoCreatedProducts(prisma, {});

    expect(result.products.map((r) => r.id)).toContain(p.id);
    expect(result.total).toBe(1);
    expect(result.products[0]).toMatchObject({
      janCode: "4900000000011",
      name: "自動商品",
      isAutoCreated: true,
      needsReview: true,
    });
  });

  // 2. 通常商品（is_auto_created=false）は出ない
  it("excludes normal (non auto-created) products", async () => {
    await makeProduct("4900000000011", "通常商品", { isAutoCreated: false });
    const auto = await makeProduct("4900000000028", "自動商品", { isAutoCreated: true });

    const result = await getAutoCreatedProducts(prisma, {});

    expect(result.products.map((r) => r.id)).toEqual([auto.id]);
    expect(result.total).toBe(1);
  });

  // 3. 確認済み(needsReview=false)の自動作成も出る／reviewStatus で出し分け
  it("shows reviewed auto-created products and filters by reviewStatus", async () => {
    const pending = await makeProduct("4900000000011", "未確認", { isAutoCreated: true, needsReview: true });
    const reviewed = await makeProduct("4900000000028", "確認済み", { isAutoCreated: true, needsReview: false });

    const all = await getAutoCreatedProducts(prisma, { reviewStatus: "all" });
    expect(new Set(all.products.map((r) => r.id))).toEqual(new Set([pending.id, reviewed.id]));

    const needs = await getAutoCreatedProducts(prisma, { reviewStatus: "needs_review" });
    expect(needs.products.map((r) => r.id)).toEqual([pending.id]);

    const done = await getAutoCreatedProducts(prisma, { reviewStatus: "reviewed" });
    expect(done.products.map((r) => r.id)).toEqual([reviewed.id]);
  });

  // 4. プレースホルダJAN分類 + placeholderOnly フィルタ
  it("classifies placeholder JANs and filters with placeholderOnly", async () => {
    const placeholder = await makeProduct("AUTO_1717000000000_abc", "JANなし自動", { isAutoCreated: true });
    const realJan = await makeProduct("4900000000011", "JANあり自動", { isAutoCreated: true });

    const all = await getAutoCreatedProducts(prisma, {});
    const byId = Object.fromEntries(all.products.map((r) => [r.id, r.isPlaceholderJan]));
    expect(byId[placeholder.id]).toBe(true);
    expect(byId[realJan.id]).toBe(false);

    const onlyPlaceholder = await getAutoCreatedProducts(prisma, { placeholderOnly: true });
    expect(onlyPlaceholder.products.map((r) => r.id)).toEqual([placeholder.id]);
  });

  // 5. 取込元: 複数importを跨る場合、最古(importedAt最小)の SalesRecord の取込を採用
  it("infers import source from the OLDEST sales import (by importedAt, not record id)", async () => {
    const p = await makeProduct("4900000000011", "売上由来自動", { isAutoCreated: true });
    const earlier = await makeCsvImport("sales-jan.csv", "PRODUCT_SALES", new Date("2026-01-01T00:00:00Z"));
    const later = await makeCsvImport("sales-feb.csv", "PRODUCT_SALES", new Date("2026-02-01T00:00:00Z"));
    // わざと「新しい取込」の sales_record を先に（=小さい id で）挿入し、id ではなく importedAt で
    // 選ばれることを検証する。
    await makeSalesRecord(p.id, later.id);
    await makeSalesRecord(p.id, earlier.id);

    const result = await getAutoCreatedProducts(prisma, {});
    const row = result.products.find((r) => r.id === p.id)!;

    expect(row.importSource).toMatchObject({
      csvImportId: earlier.id,
      filename: "sales-jan.csv",
      csvType: "PRODUCT_SALES",
      via: "SALES_RECORD",
      confidence: "inferred",
    });
  });

  // 6. 取込元: 仕入(InventoryTransaction, PURCHASE_CSV)経路は via=INVENTORY_TX
  it("infers import source via inventory_transactions for purchase-created products", async () => {
    const p = await makeProduct("AUTO_1717000000001_xyz", "仕入由来自動", { isAutoCreated: true });
    const corec = await makeCsvImport("corec-2026.pdf", "PURCHASE_COREC", new Date("2026-03-01T00:00:00Z"));
    await makeTx(p.id, "PURCHASE_CSV", 5, 5, corec.id);
    // csvImportId が無い在庫変動は取込元の根拠にならない（無視される）
    await makeTx(p.id, "ADJUSTMENT", -1, 4);

    const result = await getAutoCreatedProducts(prisma, {});
    const row = result.products.find((r) => r.id === p.id)!;

    expect(row.importSource).toMatchObject({
      csvImportId: corec.id,
      filename: "corec-2026.pdf",
      csvType: "PURCHASE_COREC",
      via: "INVENTORY_TX",
      confidence: "inferred",
    });
  });

  // 7. 紐付く取込行が無い → importSource は null
  it("returns null import source when nothing links the product to an import", async () => {
    const p = await makeProduct("4900000000011", "孤立自動", { isAutoCreated: true });
    await makeTx(p.id, "ADJUSTMENT", 3, 3); // csvImportId なし

    const result = await getAutoCreatedProducts(prisma, {});
    const row = result.products.find((r) => r.id === p.id)!;

    expect(row.importSource).toBeNull();
  });

  // 8. read-only: 在庫数も inventory_transactions 件数も変えない
  it("is read-only: does not change stock or create transactions", async () => {
    const p = await makeProduct("4900000000011", "自動商品", { isAutoCreated: true, currentStock: 7 });
    await makeTx(p.id, "SALE_CSV", 3, 7);

    const stockBefore = (await prisma.product.findUnique({ where: { id: p.id } }))!.currentStock;
    const txCountBefore = await prisma.inventoryTransaction.count();

    await getAutoCreatedProducts(prisma, {});

    const stockAfter = (await prisma.product.findUnique({ where: { id: p.id } }))!.currentStock;
    const txCountAfter = await prisma.inventoryTransaction.count();

    expect(stockAfter).toBe(stockBefore);
    expect(txCountAfter).toBe(txCountBefore);
  });

  // 9. summary はサブフィルタ非依存の母集合内訳
  it("reports summary counts over the auto-created base set", async () => {
    await makeProduct("4900000000011", "未確認1", { isAutoCreated: true, needsReview: true });
    await makeProduct("AUTO_1717000000000_a", "未確認プレースホルダ", { isAutoCreated: true, needsReview: true });
    await makeProduct("4900000000035", "確認済み1", { isAutoCreated: true, needsReview: false });
    await makeProduct("4900000000042", "通常商品", { isAutoCreated: false });

    const result = await getAutoCreatedProducts(prisma, {});

    expect(result.summary).toEqual({
      autoCreatedTotal: 3,
      needsReviewTotal: 2,
      reviewedTotal: 1,
      placeholderJanTotal: 1,
    });
  });

  // 10. limit/offset とページング前 total
  it("applies limit/offset and reports the unpaged total", async () => {
    for (let i = 0; i < 5; i++) {
      await makeProduct(`4900000${String(i).padStart(6, "0")}`, `自動${i}`, { isAutoCreated: true });
    }

    const firstPage = await getAutoCreatedProducts(prisma, { limit: 2, offset: 0 });
    expect(firstPage.products).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.limit).toBe(2);
    expect(firstPage.offset).toBe(0);

    const secondPage = await getAutoCreatedProducts(prisma, { limit: 2, offset: 2 });
    expect(secondPage.products).toHaveLength(2);
    const firstIds = new Set(firstPage.products.map((r) => r.id));
    expect(secondPage.products.some((r) => firstIds.has(r.id))).toBe(false);
  });

  // 11. id 降順（新しい自動作成が上）
  it("orders by id desc (newest auto-created first)", async () => {
    const a = await makeProduct("4900000000011", "A", { isAutoCreated: true });
    const b = await makeProduct("4900000000028", "B", { isAutoCreated: true });
    const c = await makeProduct("4900000000035", "C", { isAutoCreated: true });

    const result = await getAutoCreatedProducts(prisma, {});

    expect(result.products.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  // 12. department フィルタ
  it("filters by department", async () => {
    const food = await makeProduct("4900000000011", "食品自動", { isAutoCreated: true, categoryId });
    await makeProduct("4900000000028", "アパレル自動", { isAutoCreated: true, categoryId: apparelCategoryId });

    const result = await getAutoCreatedProducts(prisma, { department: "FOOD" });

    expect(result.products.map((r) => r.id)).toEqual([food.id]);
    expect(result.products[0].department).toBe("FOOD");
    expect(result.total).toBe(1);
  });

  // 13. レスポンス全体に sourceConfidence="inferred" を含む
  it("marks the whole response as inferred source confidence", async () => {
    await makeProduct("4900000000011", "自動商品", { isAutoCreated: true });

    const result = await getAutoCreatedProducts(prisma, {});

    expect(result.sourceConfidence).toBe("inferred");
    expect(result.skippedRows).toEqual([]);
  });

  // 14. search: name / janCode の両方で検索でき、通常商品(isAutoCreated=false)は対象外
  it("filters by search across name and janCode (excluding non auto-created)", async () => {
    await makeProduct("4900000000011", "昆布巻", { isAutoCreated: true });
    const yokan = await makeProduct("4900000000028", "羊羹", { isAutoCreated: true });
    // isAutoCreated=false は search に一致しても母集合外
    await makeProduct("4900000000035", "昆布だし", { isAutoCreated: false });

    // name 一致（自動作成の「昆布巻」のみ。非自動作成の「昆布だし」は除外）
    const byName = await getAutoCreatedProducts(prisma, { search: "昆布" });
    expect(byName.products.map((r) => r.name)).toEqual(["昆布巻"]);
    expect(byName.total).toBe(1);

    // janCode 一致（「羊羹」のみ）
    const byJan = await getAutoCreatedProducts(prisma, { search: "0028" });
    expect(byJan.products.map((r) => r.id)).toEqual([yokan.id]);
    expect(byJan.products[0].janCode).toBe("4900000000028");
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
    // history テストには無い sales_records を追加（取込元推定の SALES_RECORD 経路に必要）。
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
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
