import "./db";
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { dbPlugin } from "./db-runtime";
import { createFullApiRoutes } from "./routes";
import { sseRoutes } from "./sse";

/**
 * Bun product app — chained without reassignment so Eden `App` typing stays intact.
 * Node uses `createApp({ runtime: "node" })` instead.
 */
export const app = new Elysia()
  .use(dbPlugin)
  .use(createFullApiRoutes())
  .use(sseRoutes)
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
