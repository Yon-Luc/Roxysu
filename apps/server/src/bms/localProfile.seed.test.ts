import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import { bmsTableCache } from "@roxysu/db/schema";
import { loadBundledBmsTables } from "@roxysu/db/bms-tables";
import type { Db } from "@roxysu/db/types";
import { eq } from "drizzle-orm";
import {
  localTableCompletion,
  resetBundledTablesSeedForTests,
  seedBundledLocalTables,
} from "./localProfile";

let db: Db;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-bundled-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("seedBundledLocalTables", () => {
  test("a same-id Hub row imported yesterday wins over the bundled stamp", async () => {
    resetBundledTablesSeedForTests();
    const bundled = loadBundledBmsTables()[0]!;
    await db.insert(bmsTableCache).values({
      versionId: bundled.versionId,
      tableId: bundled.tableId,
      name: bundled.parsed.name,
      symbol: bundled.parsed.symbol,
      sourceUrl: bundled.sourceUrl,
      importedAt: new Date(),
      levelOrderJson: JSON.stringify(bundled.parsed.levelOrder),
      entriesJson: JSON.stringify(
        bundled.parsed.entries.map((entry) => ({
          level: entry.level,
          levelIndex: entry.levelIndex,
          md5: entry.md5,
          sha256: entry.sha256,
          title: entry.title,
          artist: entry.artist,
        })),
      ),
      unresolvedCount: bundled.parsed.unresolvedCount,
    });
    await db.insert(bmsTableCache).values({
      versionId: "hub-version",
      tableId: bundled.tableId,
      name: "Hub table",
      symbol: "H",
      sourceUrl: "https://example.test/table.json",
      importedAt: new Date(Date.now() - 86_400_000),
      levelOrderJson: JSON.stringify(["1"]),
      entriesJson: JSON.stringify([
        {
          level: "1",
          levelIndex: 0,
          md5: null,
          sha256: null,
          title: "hub-song",
          artist: "hub",
        },
      ]),
      unresolvedCount: 0,
    });

    await seedBundledLocalTables(db);
    await seedBundledLocalTables(db);

    const row = await db
      .select({ importedAt: bmsTableCache.importedAt })
      .from(bmsTableCache)
      .where(eq(bmsTableCache.versionId, bundled.versionId))
      .get();
    expect(row?.importedAt.getTime()).toBe(0);

    const tables = await localTableCompletion(db, "standard", "aa");
    const picked = tables.find((table) => table.tableId === bundled.tableId);
    expect(picked?.versionId).toBe("hub-version");
    expect(picked?.levels.some((level) => level.songs.some((song) => song.title === "hub-song"))).toBe(
      true,
    );
  });

  test("with no Hub row, completion still uses the bundled entries", async () => {
    resetBundledTablesSeedForTests();
    await db.delete(bmsTableCache);
    await seedBundledLocalTables(db);
    const bundled = loadBundledBmsTables();
    const tables = await localTableCompletion(db, "standard", "aa");
    expect(tables.map((table) => table.tableId).sort()).toEqual(
      bundled.map((table) => table.tableId).sort(),
    );
    expect(tables.some((table) => table.levels.some((level) => level.songs.length > 0))).toBe(
      true,
    );
  });
});
