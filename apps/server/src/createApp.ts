import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dbPlugin } from "./db-runtime";
import { createProductApiRoutes } from "./routes";
import { sseRoutes } from "./sse";

export type CreateAppOptions = {
  /** Directory of prebuilt static assets (`dist/public`). */
  staticAssetsDir: string;
};

/** @elysiajs/static omits Content-Type on Node — Chromium then rejects module scripts. */
const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript;charset=utf-8",
  ".mjs": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".json": "application/json;charset=utf-8",
  ".map": "application/json;charset=utf-8",
  ".webmanifest": "application/manifest+json;charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveStaticFile(root: string, urlPathname: string): string | null {
  const rootResolved = path.resolve(root);
  const relative = decodeURIComponent(urlPathname).replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const full = path.resolve(rootResolved, relative);
  const rootPrefix = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  if (full !== rootResolved && !full.startsWith(rootPrefix)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}

async function readIndexHtml(staticAssetsDir: string): Promise<Response> {
  const html = await readFile(path.join(staticAssetsDir, "index.html"));
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

async function readStaticFile(filePath: string): Promise<Response> {
  const body = await readFile(filePath);
  // Desktop Chromium caches aggressively; avoid sticky empty-MIME entries across upgrades.
  const cacheControl = process.env.ROXYSU_DESKTOP
    ? "no-cache"
    : "public, max-age=86400";
  return new Response(body, {
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Node / Electron product app (no Lab, no download mirrors, no service worker).
 * Bun Eden typing lives in `app.ts` — do not widen that chain through this helper.
 */
export async function createApp(options: CreateAppOptions) {
  const assetsDir = path.resolve(options.staticAssetsDir);

  return new Elysia({ adapter: node() })
    .use(dbPlugin)
    .use(createProductApiRoutes())
    .use(sseRoutes)
    .get("/", () => readIndexHtml(assetsDir))
    .get("/*", async ({ request, set }) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api")) {
        set.status = 404;
        return "Not Found";
      }

      const filePath = resolveStaticFile(assetsDir, url.pathname);
      if (filePath) return readStaticFile(filePath);

      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("text/html")) return readIndexHtml(assetsDir);

      set.status = 404;
      return "Not Found";
    });
}
