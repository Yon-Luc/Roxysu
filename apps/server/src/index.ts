import { clearStuckRealmReaderPause, closeDb } from "@roxysu/db/client.bun";
import { app } from "./app";
import { db } from "./db";
import { startPollLoop } from "./sse";
import { startAnalyticsPipeline } from "./analytics/pipeline";
import { startBmsSync } from "./bms/sync";
import { startDanVariantJob } from "./map-analysis/danVariantJob";
import { maybePullCalcBundleOnBoot } from "./map-analysis/calcBundle";
import { startReworkDanBackfill } from "./map-analysis/reworkDanJob";
import { startCollectionMatchCache } from "./shared/collectionMatchCache";
import { ensureTosuStarted, stopTosuAdapter } from "./tosu";
import { clearStuckMirrorBatchLocks } from "./mirrors";
import { shutdownBackgroundWork } from "./shutdownJobs";

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

// Kick off tosu adapter init before listening; /api/tosu/live awaits the same
// bootstrap, so the snapshot can never be served with uninitialized settings.
void ensureTosuStarted(db);

app.listen(4321);
const stopPoll = startPollLoop(db);
const stopAnalytics = startAnalyticsPipeline(db);
const stopBmsSync = startBmsSync(db);
const stopDanVariants = startDanVariantJob(db);
startCollectionMatchCache(db);
// Boot calc-bundle replace may drop stored rows the shipped file does not
// contain; recomputing only those keeps the version bump cheap.
void maybePullCalcBundleOnBoot(db).then((boot) => {
  if (boot && boot.droppedLeftovers > 0) startReworkDanBackfill(db);
});

console.log(
  `🦊 Roxysu running at http://${app.server?.hostname}:${app.server?.port}`,
);

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

  stopTosuAdapter();
  stopBmsSync();
  stopAnalytics();
  stopDanVariants();
  stopPoll();
  try {
    await app.stop(true);
  } catch (err) {
    console.error("[shutdown] app.stop failed", err);
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

export type { App } from "./app";
