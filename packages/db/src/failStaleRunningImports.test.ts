import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureDb, closeDb, imports } from "./client.bun";
import { failStaleRunningImports } from "./failStaleRunningImports";
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
