import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { dbPlugin } from "./db";
import { apiRoutes } from "./routes";
import { sseRoutes } from "./sse";

/** Elysia app instance — listen separately so Eden can import `App` without side effects. */
export const app = new Elysia()
  .use(dbPlugin)
  .use(apiRoutes)
  .use(sseRoutes)
  // Service workers must not be long-cached or updates stall for a day.
  .get("/sw.js", async ({ set }) => {
    set.headers["Content-Type"] = "text/javascript;charset=utf-8";
    set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    return Bun.file("public/sw.js");
  })
  .use(
    await staticPlugin({
      assets: "public",
      prefix: "/",
      indexHTML: true,
      bunFullstack: true,
      ignorePatterns: [/sw\.js$/],
    }),
  );

export type App = typeof app;
