import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { closeDb, ensureDb, waitForSchema } from "./client.bun";
import {
  SchemaNotCurrentError,
  appliedMigrationMillis,
  expectedMigrationMillis,
  skipMigrateFromEnv,
  waitForSchemaCurrent,
} from "./schemaVersion";
import type { Db } from "./types";

const migrationsFolder = path.join(import.meta.dir, "..", "drizzle");

describe("ensureDb migrate option", () => {
  let dir: string;
  const open: Db[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-schema-"));
  });
  afterEach(() => {
    for (const d of open.splice(0)) closeDb(d);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ROXYSU_SKIP_MIGRATE;
  });

  function tableExists(db: Db, name: string): boolean {
    const rows = db.all<{ n: string }>(
      sql`SELECT name AS n FROM sqlite_master WHERE type='table' AND name=${name}`,
    );
    return rows.length > 0;
  }

  test("default migrates", () => {
    const db = ensureDb(path.join(dir, "a.sqlite"));
    open.push(db);
    expect(tableExists(db, "imports")).toBe(true);
    expect(appliedMigrationMillis(db)).toBe(
      expectedMigrationMillis(migrationsFolder),
    );
  });

  test("migrate:false leaves the file empty", () => {
    const db = ensureDb(path.join(dir, "b.sqlite"), { migrate: false });
    open.push(db);
    expect(tableExists(db, "imports")).toBe(false);
    expect(appliedMigrationMillis(db)).toBeNull();
  });

  test("ROXYSU_SKIP_MIGRATE skips, explicit option wins", () => {
    process.env.ROXYSU_SKIP_MIGRATE = "1";
    expect(skipMigrateFromEnv()).toBe(true);
    const skipped = ensureDb(path.join(dir, "c.sqlite"));
    open.push(skipped);
    expect(tableExists(skipped, "imports")).toBe(false);

    const forced = ensureDb(path.join(dir, "d.sqlite"), { migrate: true });
    open.push(forced);
    expect(tableExists(forced, "imports")).toBe(true);
  });

  test("skipMigrateFromEnv parses falsy values", () => {
    expect(skipMigrateFromEnv({})).toBe(false);
    expect(skipMigrateFromEnv({ ROXYSU_SKIP_MIGRATE: "0" })).toBe(false);
    expect(skipMigrateFromEnv({ ROXYSU_SKIP_MIGRATE: "true" })).toBe(true);
  });
});

describe("waitForSchemaCurrent", () => {
  let dir: string;
  const open: Db[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-wait-"));
  });
  afterEach(() => {
    for (const d of open.splice(0)) closeDb(d);
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns immediately when already current", async () => {
    const db = ensureDb(path.join(dir, "a.sqlite"));
    open.push(db);
    await waitForSchema(db, {
      sleep: async () => {
        throw new Error("should not sleep");
      },
    });
  });

  test("waits until the migrator finishes", async () => {
    const file = path.join(dir, "b.sqlite");
    const reader = ensureDb(file, { migrate: false });
    open.push(reader);
    let sleeps = 0;
    let waitingCalls = 0;
    await waitForSchema(reader, {
      onWaiting: () => {
        waitingCalls++;
      },
      sleep: async () => {
        sleeps++;
        if (sleeps === 3) open.push(ensureDb(file)); // the other process migrates
      },
    });
    expect(sleeps).toBe(3);
    expect(waitingCalls).toBe(1);
    expect(appliedMigrationMillis(reader)).toBe(
      expectedMigrationMillis(migrationsFolder),
    );
  });

  test("throws a clear bounded error when never migrated", async () => {
    const db = ensureDb(path.join(dir, "c.sqlite"), { migrate: false });
    open.push(db);
    let clock = 0;
    const err = await waitForSchemaCurrent(db, {
      migrationsFolder,
      timeoutMs: 1_000,
      intervalMs: 400,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SchemaNotCurrentError);
    expect((err as Error).message).toContain("not current");
    expect((err as SchemaNotCurrentError).applied).toBeNull();
    expect(clock).toBeLessThan(2_000);
  });

  test("an older applied schema is not current", async () => {
    const db = ensureDb(path.join(dir, "d.sqlite"));
    open.push(db);
    db.run(sql`UPDATE __drizzle_migrations SET created_at = created_at - 1000000`);
    await expect(
      waitForSchemaCurrent(db, {
        migrationsFolder,
        timeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(SchemaNotCurrentError);
  });

  test("isCancelled abandons the wait without throwing", async () => {
    const db = ensureDb(path.join(dir, "e.sqlite"), { migrate: false });
    open.push(db);
    await waitForSchemaCurrent(db, {
      migrationsFolder,
      isCancelled: () => true,
    });
  });
});
