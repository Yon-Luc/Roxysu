import type { Db } from "@roxysu/db/client.bun";
import { subscribe, publish, type AppEvent } from "../shared/events";
import { runRetryEngine } from "./retry";
import { runSessionEngine } from "./session";
import { runMasteryEngine } from "./mastery/engine";
import { runStatisticsEngine } from "./statistics";

const DEBOUNCE_MS = 250;

let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function runAnalyticsPipeline(db: Db): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    do {
      pending = false;
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
  // Initial compute on boot
  schedule(db);

  return subscribe((event) => {
    if (shouldRun(event)) schedule(db);
  });
}
