import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { node } from "@elysiajs/node";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dbPlugin } from "./db-runtime";
import { createProductApiRoutes } from "./routes";
import { sseRoutes } from "./sse";

export type CreateAppOptions = {
  /** Directory of prebuilt static assets (`dist/public`). */
  staticAssetsDir: string;
};

async function readIndexHtml(staticAssetsDir: string): Promise<Response> {
  const html = await readFile(path.join(staticAssetsDir, "index.html"));
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

/**
 * Node / Electron product app (no Lab, no download mirrors, no service worker).
 * Bun Eden typing lives in `app.ts` — do not widen that chain through this helper.
 */
export async function createApp(options: CreateAppOptions) {
  return new Elysia({ adapter: node() })
    .use(dbPlugin)
    .use(createProductApiRoutes())
    .use(sseRoutes)
    .get("/", () => readIndexHtml(options.staticAssetsDir))
    .use(
      await staticPlugin({
        assets: options.staticAssetsDir,
        prefix: "/",
        indexHTML: true,
        bunFullstack: false,
      }),
    )
    .onError(({ code, request }) => {
      if (code !== "NOT_FOUND") return;
      const accept = request.headers.get("accept") ?? "";
      if (!accept.includes("text/html")) return;
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api")) return;
      return readIndexHtml(options.staticAssetsDir);
    });
}
