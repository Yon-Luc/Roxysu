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
  .use(
    await staticPlugin({
      assets: "public",
      prefix: "/",
      indexHTML: true,
      bunFullstack: true,
    }),
  );

export type App = typeof app;
