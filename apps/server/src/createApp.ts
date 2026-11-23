import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { dbPlugin } from "./db-runtime";
import { originGuard } from "./originGuard";
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

/**
 * The UI loads local scripts/styles only; Google Fonts is the one remote origin.
 * `index.html` has no inline scripts (the boot shim is served as `/boot.js`), so
 * `script-src` needs no `'unsafe-inline'`.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  // The Hub client fetches the Hub directly (default dev `http://localhost:4322`);
  // skin import and replay export also `fetch()` data/blob URLs.
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:* blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers added to static HTML/asset responses (not to API JSON). */
function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Map a URL pathname to a file inside `root`, or null when it is malformed or
 * escapes the root. Async so a slow filesystem does not block the event loop.
 */
export async function resolveStaticFile(
  root: string,
  urlPathname: string,
): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    // Malformed escape (e.g. a dangling `%`) — let the caller fall back to the SPA.
    return null;
  }
  const rootResolved = path.resolve(root);
  const relative = decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const full = path.resolve(rootResolved, relative);
  const rootPrefix = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  if (full !== rootResolved && !full.startsWith(rootPrefix)) return null;
  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  return full;
}

async function readIndexHtml(staticAssetsDir: string): Promise<Response> {
  const html = await readFile(path.join(staticAssetsDir, "index.html"));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      // Same rule as `cacheControlFor`: HTML must revalidate so a UI update is
      // picked up together with the hashed bundle it references.
      "Cache-Control": "no-cache",
      ...securityHeaders(),
    },
  });
}

/** Hashed build outputs (index-deadbeef.js) are immutable; HTML must revalidate. */
function cacheControlFor(filePath: string): string {
  const base = path.basename(filePath);
  // `boot.js` is the unhashed pre-paint bootstrap: an update must not be served
  // stale for a day, or the old shim runs against a new bundle.
  if (base === "index.html" || base.endsWith(".html") || base === "sw.js" || base === "boot.js") {
    return "no-cache";
  }
  // bun build-ui: [name]-[hash].[ext]
  if (/-[a-z0-9]{6,}\.(js|css|png|jpe?g|gif|svg|webp|woff2?)$/i.test(base)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=86400";
}

/** Null when the file vanished between resolution and the read race-free fallback. */
async function readStaticFile(filePath: string): Promise<Response | null> {
  try {
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        "Content-Type": contentTypeFor(filePath),
        "Cache-Control": cacheControlFor(filePath),
        ...securityHeaders(),
      },
    });
  } catch {
    return null;
  }
}

/**
 * Node / Electron product app (no Lab, no service worker).
 * Bun Eden typing lives in `app.ts` — do not widen that chain through this helper.
 */
export async function createApp(options: CreateAppOptions) {
  const assetsDir = path.resolve(options.staticAssetsDir);

  return new Elysia({ adapter: node() })
    .use(originGuard())
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

      const filePath = await resolveStaticFile(assetsDir, url.pathname);
      if (filePath) {
        const file = await readStaticFile(filePath);
        if (file) return file;
      }

      const accept = request.headers.get("accept") ?? "";
      if (accept.includes("text/html")) return readIndexHtml(assetsDir);

      set.status = 404;
      return "Not Found";
    });
}
