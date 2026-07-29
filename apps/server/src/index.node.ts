import { closeDb } from "@roxysu/db/client.node";
import { db } from "./db.node";
import { createApp } from "./createApp";
import { startPollLoop } from "./sse";
import { startAnalyticsPipeline } from "./analytics/pipeline";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultStaticDir = path.resolve(here, "../dist/public");
  const staticAssetsDir =
    process.env.ROXYSU_STATIC_DIR?.trim() || defaultStaticDir;

  const port = Number(process.env.ROXYSU_PORT ?? process.env.PORT ?? 4321);
  const hostname = process.env.ROXYSU_HOST ?? "127.0.0.1";

  const app = await createApp({
    staticAssetsDir,
  });

  app.listen({ port, hostname });
  const stopPoll = startPollLoop(db);
  const stopAnalytics = startAnalyticsPipeline(db);

  console.log(`🦊 Roxysu (node) running at http://${hostname}:${port}`);
  console.log(`[static] ${staticAssetsDir}`);

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nshutting down (${signal})…`);

    stopAnalytics();
    stopPoll();
    try {
      // @elysiajs/node may not keep the same stop() contract as Bun.
      if (typeof app.stop === "function") {
        await app.stop(true);
      }
    } catch {
      // ignore — process is exiting anyway
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
