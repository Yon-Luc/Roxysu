import { clearStuckRealmReaderPause, closeDb } from "@roxysu/db/client.bun";
import { app } from "./app";
import { db } from "./db";
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
import { ensureTosuStarted, stopTosuAdapter } from "./tosu";
import { clearStuckMirrorBatchLocks } from "./mirrors";
import { shutdownBackgroundWork } from "./shutdownJobs";
import { discardScoreTransferUploads } from "./score-transfer/transfer";
import {
  addrInUseMessage,
  isAddrInUseError,
  listenUrl,
  resolveListen,
  warnIfListenExposed,
} from "./listen";

// A rejected background task must not take the local server down mid-session;
// log it so the cause is visible, and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("[roxysu] unhandled rejection", reason);
});

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

const listen = resolveListen();
warnIfListenExposed(listen.hostname);

function startBackground(): void {
  // /api/tosu/live awaits the same bootstrap, so the snapshot is not served
  // with uninitialized settings.
  void ensureTosuStarted(db);
  stopPoll = startPollLoop(db);
  stopAnalytics = startAnalyticsPipeline(db);
  stopBmsSync = startBmsSync(db);
  stopDanVariants = startDanVariantJob(db);
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
}

let stopPoll: () => void = () => {};
let stopAnalytics: () => void = () => {};
let stopBmsSync: () => void = () => {};
let stopDanVariants: () => void = () => {};

try {
  app.listen({ port: listen.port, hostname: listen.hostname });
} catch (err) {
  if (isAddrInUseError(err)) console.error(addrInUseMessage(listen.port));
  else console.error("[roxysu] failed to start", err);
  process.exit(1);
}
startBackground();
console.log(`🦊 Roxysu running at ${listenUrl(listen)}`);

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
    discardScoreTransferUploads();
  } catch {
    // best-effort
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
