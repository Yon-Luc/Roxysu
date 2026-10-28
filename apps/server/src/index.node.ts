import {
  clearStuckRealmReaderPause,
  closeDb,
} from "@roxysu/db/client.node";
import { db } from "./db.node";
import { createApp } from "./createApp";
import { startPollLoop } from "./sse";
import { startAnalyticsPipeline } from "./analytics/pipeline";
import { startBmsSync } from "./bms/sync";
import { startDanVariantJob } from "./map-analysis/danVariantJob";
import { maybePullCalcBundleOnBoot } from "./map-analysis/calcBundle";
import {
  relabelStoredReworkDans,
  startReworkDanBackfill,
} from "./map-analysis/reworkDanJob";
import { startPatternAnalysisBackfill } from "./map-analysis/patternAnalysisJob";
import { startCollectionMatchCache } from "./shared/collectionMatchCache";
import { guardUpgradeSocketErrors } from "./shared/upgradeSocketGuard";
import { clearStuckMirrorBatchLocks } from "./mirrors";
import { shutdownBackgroundWork } from "./shutdownJobs";
import { ensureTosuStarted, stopTosuAdapter } from "./tosu";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultStaticDir = path.resolve(here, "../dist/public");
  const staticAssetsDir =
    process.env.ROXYSU_STATIC_DIR?.trim() || defaultStaticDir;

  const port = Number(process.env.ROXYSU_PORT ?? process.env.PORT ?? 4321);
  const hostname = process.env.ROXYSU_HOST ?? "127.0.0.1";

  if (clearStuckRealmReaderPause(db)) {
    console.log(
      "[sync] cleared stuck sync.realm_reader_paused — realm-reader can resume",
    );
  }
  if (clearStuckMirrorBatchLocks()) {
    console.log(
      "[mirrors] cleared stuck download / open-in-osu lock — batches can start again",
    );
  }

  const app = await createApp({
    staticAssetsDir,
  });

  // Kick off tosu adapter init before listening; /api/tosu/live awaits the same
  // bootstrap, so the snapshot can never be served with uninitialized settings.
  void ensureTosuStarted(db);

  app.listen({ port, hostname }, (info) => {
    // A client that hangs up mid-upgrade must not take the server with it.
    guardUpgradeSocketErrors(info);
  });
  const stopPoll = startPollLoop(db);
  const stopAnalytics = startAnalyticsPipeline(db);
  const stopBmsSync = startBmsSync(db);
  const stopDanVariants = startDanVariantJob(db);
  startCollectionMatchCache(db);
  // Boot calc-bundle replace may drop stored rows the shipped file does not
  // contain; recomputing only those keeps the version bump cheap. Nulled illegal
  // chart shapes (keymode terms, e.g. 7K jumpstream) are refilled by the pattern
  // job the same way.
  void maybePullCalcBundleOnBoot(db).then((boot) => {
    // After apply, so a shipped bundle's band-suffixed labels do not stick.
    relabelStoredReworkDans(db);
    if (boot && boot.droppedLeftovers > 0) startReworkDanBackfill(db);
    if (boot && boot.nulledShapes > 0) startPatternAnalysisBackfill(db);
  });

  console.log(`🦊 Roxysu (node) running at http://${hostname}:${port}`);
  console.log(`[static] ${staticAssetsDir}`);

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nshutting down (${signal})…`);

    // If we die mid-collection-sync, don't leave realm-reader paused forever.
    try {
      clearStuckRealmReaderPause(db);
    } catch {
      // best-effort
    }

    stopBmsSync();
    stopAnalytics();
    stopDanVariants();
    stopTosuAdapter();
    stopPoll();
    try {
      // @elysiajs/node may not keep the same stop() contract as Bun.
      if (typeof app.stop === "function") {
        await app.stop(true);
      }
    } catch {
      // ignore — process is exiting anyway
    }
    // Background writers (analytics run, backfill jobs, mirror batch) must be
    // idle before the local mirror closes under them.
    try {
      await shutdownBackgroundWork(db);
    } catch (err) {
      console.error("[shutdown] background work did not stop cleanly", err);
    }
    try {
      closeDb(db);
    } catch {
      // already closed
    }
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[roxysu-node] failed to start", err);
  process.exit(1);
});
