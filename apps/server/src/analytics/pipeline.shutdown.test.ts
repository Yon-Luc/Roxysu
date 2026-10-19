import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { imports } from "@roxysu/db/schema";
import type { Db } from "../db-runtime";
import { subscribe } from "../shared/events";
import {
  isAnalyticsPipelineRunning,
  resetAnalyticsPipelineShutdownForTests,
  runAnalyticsPipeline,
  shutdownAnalyticsPipeline,
  startAnalyticsPipeline,
} from "./pipeline";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "..", "..", "..", "packages", "db", "drizzle");

let db: Db;

beforeAll(() => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
});

afterAll(() => {
  // Module state is shared with other test files in the same bun process.
  resetAnalyticsPipelineShutdownForTests();
  closeDb(db);
});

describe("shutdownAnalyticsPipeline", () => {
  test("awaits an in-flight run and refuses new runs afterwards", async () => {
    // A fresh `running` import keeps the run parked in the import wait loop.
    await db.insert(imports).values({
      kind: "full",
      status: "running",
      startedAt: new Date(),
      realmSchemaVersion: 1,
    });

    const run = runAnalyticsPipeline(db);
    expect(isAnalyticsPipelineRunning()).toBe(true);

    let runSettled = false;
    void run.then(() => {
      runSettled = true;
    });

    const drained = await shutdownAnalyticsPipeline({ timeoutMs: 5_000 });
    expect(drained).toBe(true);
    expect(isAnalyticsPipelineRunning()).toBe(false);
    await run;
    expect(runSettled).toBe(true);

    // No new run starts after stop, even once the import is no longer running.
    await db.update(imports).set({ status: "failed" });
    let dashboardEvents = 0;
    const unsubscribe = subscribe((event) => {
      if (event.type === "dashboard.updated") dashboardEvents += 1;
    });
    await runAnalyticsPipeline(db, { forceFull: true });
    expect(isAnalyticsPipelineRunning()).toBe(false);
    expect(dashboardEvents).toBe(0);
    unsubscribe();
  });

  test("startAnalyticsPipeline re-arms the pipeline after a shutdown", async () => {
    await shutdownAnalyticsPipeline();
    const stop = startAnalyticsPipeline(db);
    try {
      let dashboardEvents = 0;
      const unsubscribe = subscribe((event) => {
        if (event.type === "dashboard.updated") dashboardEvents += 1;
      });
      await runAnalyticsPipeline(db, { forceFull: true });
      unsubscribe();
      expect(dashboardEvents).toBe(1);
    } finally {
      stop();
      await shutdownAnalyticsPipeline();
    }
  });

  test("returns true immediately when nothing is running", async () => {
    expect(await shutdownAnalyticsPipeline()).toBe(true);
  });
});
