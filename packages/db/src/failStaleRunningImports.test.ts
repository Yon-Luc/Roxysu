import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureDb, closeDb, imports } from "./client.bun";
import {
  failStaleRunningImports,
  failStaleRunningImportsOlderThan,
  STALE_RUNNING_IMPORT_ERROR,
  STALE_RUNNING_MS,
} from "./failStaleRunningImports";
import type { Db } from "./types";

describe("failStaleRunningImports", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-imports-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("no-ops when nothing is running", () => {
    expect(failStaleRunningImports(db)).toBe(0);
  });

  test("marks running rows failed", () => {
    db.insert(imports)
      .values({
        kind: "incremental",
        status: "running",
        startedAt: new Date(0),
        realmSchemaVersion: 0,
      })
      .run();
    db.insert(imports)
      .values({
        kind: "incremental",
        status: "success",
        startedAt: new Date(0),
        finishedAt: new Date(0),
        realmSchemaVersion: 0,
      })
      .run();

    expect(failStaleRunningImports(db)).toBe(1);

    const rows = db
      .select({ status: imports.status, error: imports.error })
      .from(imports)
      .all();
    const failed = rows.filter((r) => r.status === "failed");
    const success = rows.filter((r) => r.status === "success");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toBe("stale running (reader restart)");
    expect(success).toHaveLength(1);
    expect(failStaleRunningImports(db)).toBe(0);
  });
});

describe("failStaleRunningImportsOlderThan", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-imports-age-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function addRunning(startedAtMs: number) {
    db.insert(imports)
      .values({
        kind: "incremental",
        status: "running",
        startedAt: new Date(startedAtMs),
        realmSchemaVersion: 0,
      })
      .run();
  }

  test("fails only running imports older than the threshold", () => {
    const now = 100 * 60_000;
    addRunning(now - STALE_RUNNING_MS - 1); // stale
    addRunning(now - STALE_RUNNING_MS + 1_000); // still within threshold
    db.insert(imports)
      .values({
        kind: "full",
        status: "success",
        startedAt: new Date(0),
        finishedAt: new Date(1),
        realmSchemaVersion: 0,
      })
      .run();

    expect(failStaleRunningImportsOlderThan(db, STALE_RUNNING_MS, now)).toBe(1);

    const rows = db
      .select({
        status: imports.status,
        error: imports.error,
        finishedAt: imports.finishedAt,
      })
      .from(imports)
      .all();
    expect(rows.filter((r) => r.status === "running")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "success")).toHaveLength(1);
    const failed = rows.filter((r) => r.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toBe(STALE_RUNNING_IMPORT_ERROR);
    expect(failed[0]?.finishedAt?.getTime()).toBe(now);

    expect(failStaleRunningImportsOlderThan(db, STALE_RUNNING_MS, now)).toBe(0);
  });

  test("threshold is the shared 10 minute constant by default", () => {
    expect(STALE_RUNNING_MS).toBe(10 * 60_000);
    const now = Date.now();
    addRunning(now - STALE_RUNNING_MS - 5_000);
    expect(failStaleRunningImportsOlderThan(db)).toBe(1);
  });
});
