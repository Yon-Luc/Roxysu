import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, ensureDb, imports } from "@roxysu/db/client.bun";
import { STALE_RUNNING_MS } from "@roxysu/db/stale-imports";
import type { Db } from "@roxysu/db/types";
import { createStaleImportSweep } from "./staleImportSweep";

describe("createStaleImportSweep", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-sweep-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function addRunning(startedAt: number) {
    db.insert(imports)
      .values({
        kind: "incremental",
        status: "running",
        startedAt: new Date(startedAt),
        realmSchemaVersion: 0,
      })
      .run();
  }

  test("fails an old running import on first call, leaves a fresh one, then throttles", () => {
    const t0 = 10_000_000;
    let clock = t0;
    addRunning(t0 - STALE_RUNNING_MS - 1);
    const sweep = createStaleImportSweep(db, 60_000, () => clock);

    expect(sweep()).toBe(1);

    addRunning(t0 - STALE_RUNNING_MS - 1);
    clock = t0 + 1_000;
    expect(sweep()).toBe(0); // throttled

    clock = t0 + 61_000;
    expect(sweep()).toBe(1);

    addRunning(clock - 1_000); // fresh: reader still working
    clock += 61_000;
    expect(sweep()).toBe(0);
    const rows = db.select({ status: imports.status }).from(imports).all();
    expect(rows.filter((r) => r.status === "running")).toHaveLength(1);
  });
});
