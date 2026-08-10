import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { runMigrations } from "./db";
import { resolveJwtSecret } from "./services/jwtSecret";
import { tickSearchCacheRefreshes } from "./services/cacheRefreshCron";
import { authRoutes } from "./routes/auth";
import { collectionRoutes } from "./routes/collections";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";

// Fail closed on missing/weak JWT secret before binding the port.
resolveJwtSecret();

// Run DB migrations before the server starts
runMigrations();

const PORT = parseInt(process.env.PORT ?? "4322", 10);

const app = new Elysia()
  .use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "*",
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
  .use(adminRoutes)
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
  .listen(PORT);

console.log(`[hub] Running at http://localhost:${PORT}`);

export type App = typeof app;
