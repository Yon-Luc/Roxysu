import { desc, imports, type Db } from "@roxysu/db/client.bun";
import { subscribe, publish, type AppEvent } from "../shared/events";
import { runRetryEngine } from "./retry";
import { runSessionEngine } from "./session";
import { runMasteryEngine } from "./mastery/engine";
import { runStatisticsEngine } from "./statistics";

const DEBOUNCE_MS = 250;
const IMPORT_WAIT_MS = 1_000;
const IMPORT_WAIT_MAX_MS = 5 * 60_000;

let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function latestImportStatus(db: Db): string | null {
  const row = db
    .select({ status: imports.status })
    .from(imports)
    .orderBy(desc(imports.id))
    .limit(1)
    .get();
  return row?.status ?? null;
}

/** Avoid racing realm-reader's write lock during an active sync. */
async function waitForIdleImport(db: Db): Promise<void> {
  const deadline = Date.now() + IMPORT_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    if (latestImportStatus(db) !== "running") return;
    await new Promise((r) => setTimeout(r, IMPORT_WAIT_MS));
  }
  console.warn(
    "[analytics] import still running after wait — proceeding anyway",
  );
}

export async function runAnalyticsPipeline(db: Db): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    do {
      pending = false;
      await waitForIdleImport(db);
      console.log("[analytics] pipeline start");
      await runRetryEngine(db);
      await runSessionEngine(db);
      await runMasteryEngine(db);
      await runStatisticsEngine(db);
      publish({ type: "dashboard.updated" });
      console.log("[analytics] pipeline done");
    } while (pending);
  } catch (err) {
    console.error("[analytics] pipeline error", err);
  } finally {
    running = false;
  }
}

function schedule(db: Db) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runAnalyticsPipeline(db);
  }, DEBOUNCE_MS);
}

function shouldRun(event: AppEvent): boolean {
  return (
    event.type === "sync.finished" ||
    event.type === "score.imported" ||
    event.type === "score.updated"
  );
}

/** Subscribe to import events and run the analytics pipeline (debounced). */
export function startAnalyticsPipeline(db: Db): () => void {
  // Brief boot delay so realm-reader can mark imports.running before we write.
  setTimeout(() => schedule(db), 1_500);

  return subscribe((event) => {
    if (shouldRun(event)) schedule(db);
  });
}
