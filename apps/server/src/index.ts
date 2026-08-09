import { clearStuckRealmReaderPause, closeDb } from "@roxysu/db/client.bun";
import { app } from "./app";
import { db } from "./db";
import { startPollLoop } from "./sse";
import { startAnalyticsPipeline } from "./analytics/pipeline";
import { startTosuAdapter, stopTosuAdapter } from "./tosu";

if (clearStuckRealmReaderPause(db)) {
  console.log(
    "[sync] cleared stuck sync.realm_reader_paused — realm-reader can resume",
  );
}

app.listen(4321);
const stopPoll = startPollLoop(db);
const stopAnalytics = startAnalyticsPipeline(db);
void startTosuAdapter(db);

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
  stopAnalytics();
  stopPoll();
  try {
    await app.stop(true);
  } catch (err) {
    console.error("[shutdown] app.stop failed", err);
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
