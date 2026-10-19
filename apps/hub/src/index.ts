import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { db, runMigrations } from "./db";
import { resolveJwtSecret } from "./services/jwtSecret";
import { resolveCorsOrigin, resolveHubListenHost } from "./services/hubEnv";
import { migrateBlobsToRows, rehashSearchCacheKeys } from "./services/cache";
import { tickSearchCacheRefreshes } from "./services/cacheRefreshCron";
import { authRoutes } from "./routes/auth";
import { collectionRoutes } from "./routes/collections";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";
import { calcBundleRoutes } from "./routes/calcBundles";
import { osuBudgetAdminRoutes, osuScoreRoutes } from "./routes/osuScores";
import { bmsPublicRoutes, bmsRoutes } from "./routes/bms";
import { seedBundledBmsTables } from "./services/bms";

// Fail closed on missing/weak JWT secret before binding the port.
resolveJwtSecret();
const corsOrigin = resolveCorsOrigin();

// Run DB migrations before the server starts
runMigrations();
await rehashSearchCacheKeys();
await migrateBlobsToRows();
await seedBundledBmsTables(db);

const PORT = parseInt(process.env.PORT ?? "4322", 10);
const LISTEN_HOST = resolveHubListenHost();

const app = new Elysia()
  .use(
    cors({
      origin: corsOrigin,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use(
    cron({
      name: "search-cache-refresh",
      pattern: "*/1 * * * *",
      run() {
        void tickSearchCacheRefreshes();
      },
    }),
  )
  .get("/health", () => ({ status: "ok", ts: Date.now() }))
  .use(authRoutes)
  .use(collectionRoutes)
  .use(searchRoutes)
  .use(calcBundleRoutes)
  .use(osuScoreRoutes)
  .use(osuBudgetAdminRoutes)
  .use(adminRoutes)
  .use(bmsRoutes)
  .use(bmsPublicRoutes)
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { message: "Validation error", details: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { message: "Route not found" };
    }
    console.error("[hub] Unhandled error:", error);
    set.status = 500;
    return { message: "Internal server error" };
  })
  .listen(LISTEN_HOST ? { port: PORT, hostname: LISTEN_HOST } : PORT);

console.log(`[hub] Running at http://${LISTEN_HOST ?? "localhost"}:${PORT}`);

export type App = typeof app;
