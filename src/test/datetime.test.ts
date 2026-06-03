// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { toEpochMs, NORMALIZED_CREATED_AT_MS, LATEST_TX_ORDER_BY } from "../../server/datetime";
import { parseTimestamp } from "../lib/datetime";

const ISO_APRIL = "2026-04-11T23:44:48.000Z";
const SQLITE_APRIL = "2026-04-11 23:44:48"; // SQLite datetime 形式（TZ無し）
const MS_MAY = 1777771043185; // 2026-05-03 (integer ms)
const MS_JUNE = 1780366089119; // 2026-06-02 (integer ms)

describe("toEpochMs", () => {
  it("passes through a number (ms) unchanged", () => {
    expect(toEpochMs(MS_JUNE)).toBe(MS_JUNE);
  });

  it("converts a Date via getTime()", () => {
    const d = new Date(MS_MAY);
    expect(toEpochMs(d)).toBe(MS_MAY);
  });

  it("parses an ISO8601 string", () => {
    expect(toEpochMs(ISO_APRIL)).toBe(Date.parse(ISO_APRIL));
  });

  it("parses a space-separated SQLite datetime string as UTC", () => {
    // strftime('%s', ...) と整合: TZ無しは UTC とみなす
    expect(toEpochMs(SQLITE_APRIL)).toBe(Date.parse(ISO_APRIL));
  });

  it("orders mixed-type inputs chronologically once normalized", () => {
    const normalized = [MS_JUNE, SQLITE_APRIL, MS_MAY].map(toEpochMs);
    const sorted = [...normalized].sort((a, b) => a - b);
    // April(text) < May(int) < June(int)
    expect(sorted).toEqual([toEpochMs(SQLITE_APRIL), MS_MAY, MS_JUNE]);
  });

  it("throws on an unparseable string", () => {
    expect(() => toEpochMs("not-a-date")).toThrow();
  });
});

describe("parseTimestamp", () => {
  it("handles number(ms), Date, ISO and SQLite strings", () => {
    expect(parseTimestamp(MS_JUNE).getTime()).toBe(MS_JUNE);
    const d = new Date(MS_MAY);
    expect(parseTimestamp(d)).toBe(d);
    expect(parseTimestamp(ISO_APRIL).getTime()).toBe(Date.parse(ISO_APRIL));
    expect(parseTimestamp(SQLITE_APRIL).getTime()).toBe(Date.parse(ISO_APRIL));
  });
});

describe("LATEST_TX_ORDER_BY", () => {
  it("orders by id desc (type-independent latest)", () => {
    expect(LATEST_TX_ORDER_BY).toEqual({ id: "desc" });
  });
});

describe("NORMALIZED_CREATED_AT_MS sorts integer/text mixed created_at chronologically", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let tempDir = "";
  let prisma: PrismaClient;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "edostock-datetime-"));
    const databaseUrl = `file:${path.join(tempDir, "test.db")}`;
    process.env.DATABASE_URL = databaseUrl;

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    // created_at は型なし（NONE affinity）にして、integer と text の混在を実DB同様に再現する
    await prisma.$executeRawUnsafe(
      `CREATE TABLE tx (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at)`
    );
    // 真の時系列: id=1(April/text) < id=2(May/int) < id=3(June/int)
    await prisma.$executeRawUnsafe(`INSERT INTO tx (id, created_at) VALUES (1, '${SQLITE_APRIL}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO tx (id, created_at) VALUES (2, ${MS_MAY})`);
    await prisma.$executeRawUnsafe(`INSERT INTO tx (id, created_at) VALUES (3, ${MS_JUNE})`);
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

  it("demonstrates the bug: naive ORDER BY created_at is NOT chronological", async () => {
    const rows = await prisma.$queryRawUnsafe<{ id: number | bigint }[]>(
      `SELECT id FROM tx ORDER BY created_at ASC`
    );
    // SQLite 型順序(数値 < TEXT)のため text(April) が最後に来てしまう
    expect(rows.map((r) => Number(r.id))).toEqual([2, 3, 1]);
  });

  it("NORMALIZED_CREATED_AT_MS yields the true chronological order", async () => {
    const asc = await prisma.$queryRawUnsafe<{ id: number | bigint }[]>(
      `SELECT id FROM tx ORDER BY ${NORMALIZED_CREATED_AT_MS} ASC`
    );
    expect(asc.map((r) => Number(r.id))).toEqual([1, 2, 3]);

    const desc = await prisma.$queryRawUnsafe<{ id: number | bigint }[]>(
      `SELECT id FROM tx ORDER BY ${NORMALIZED_CREATED_AT_MS} DESC`
    );
    expect(desc.map((r) => Number(r.id))).toEqual([3, 2, 1]);
  });

  it("id-based ordering also yields the true latest (type-independent)", async () => {
    const rows = await prisma.$queryRawUnsafe<{ id: number | bigint }[]>(
      `SELECT id FROM tx ORDER BY id DESC`
    );
    expect(rows.map((r) => Number(r.id))).toEqual([3, 2, 1]);
  });
});
