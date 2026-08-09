import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { runMigrations } from "./db";
import { authRoutes } from "./routes/auth";
import { collectionRoutes } from "./routes/collections";
import { searchRoutes } from "./routes/search";
import { adminRoutes } from "./routes/admin";

// Run DB migrations before the server starts
runMigrations();

const PORT = parseInt(process.env.PORT ?? "4322", 10);

const app = new Elysia()
  .use(
    cors({
      origin: process.env.CORS_ORIGIN ?? "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
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
