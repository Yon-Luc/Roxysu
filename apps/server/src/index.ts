import { closeDb } from "@roxysu/db/client.bun";
import { app } from "./app";
import { db } from "./db";
import { startPollLoop } from "./sse";

app.listen(3000);
const stopPoll = startPollLoop(db);

console.log(
  `🦊 Roxysu running at http://${app.server?.hostname}:${app.server?.port}`,
);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nshutting down (${signal})…`);

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
