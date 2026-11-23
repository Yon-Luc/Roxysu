import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Db } from "@roxysu/db/types";

import { createApp, resolveStaticFile } from "./createApp";
import { bindDb } from "./db-runtime";

const INDEX_HTML =
  '<!doctype html><html><head><script src="/boot.js"></script></head><body>roxysu-ui</body></html>';
const SECRET = "outside-the-static-root";

let dir: string;
let app: Awaited<ReturnType<typeof createApp>>;

function get(pathname: string, accept = "text/html"): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${pathname}`, { headers: { accept } }),
  );
}

beforeAll(async () => {
  const root = mkdtempSync(path.join(tmpdir(), "roxysu-static-"));
  dir = path.join(root, "public");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, "secret.txt"), SECRET);
  writeFileSync(path.join(dir, "index.html"), INDEX_HTML);
  writeFileSync(path.join(dir, "app-abc123.js"), "console.log(1)");
  writeFileSync(path.join(dir, "boot.js"), "window.__boot=1");
  writeFileSync(path.join(dir, "styles.css"), "body{}");

  // Only the static helpers are exercised here; no route touches the DB.
  bindDb({} as Db);
  app = await createApp({ staticAssetsDir: dir });
});

afterAll(() => {
  rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe("resolveStaticFile", () => {
  test("resolves files inside the root", async () => {
    const resolved = await resolveStaticFile(dir, "/app-abc123.js");
    expect(resolved).toBe(path.join(dir, "app-abc123.js"));
  });

  test("a dangling percent escape returns null instead of throwing", async () => {
    expect(await resolveStaticFile(dir, "/%")).toBeNull();
    expect(await resolveStaticFile(dir, "/%zz")).toBeNull();
  });

  test("path traversal and null bytes return null", async () => {
    expect(await resolveStaticFile(dir, "/%2e%2e/secret.txt")).toBeNull();
    expect(await resolveStaticFile(dir, "/../secret.txt")).toBeNull();
    expect(await resolveStaticFile(dir, "/a%00b.js")).toBeNull();
  });

  test("directories are not served", async () => {
    expect(await resolveStaticFile(dir, "/")).toBeNull();
  });
});

describe("static responses", () => {
  test("index.html carries the security headers", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("roxysu-ui");
    expect(res.headers.get("content-type")).toBe("text/html;charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("assets keep their content type, cache policy, and headers", async () => {
    const res = await get("/app-abc123.js", "*/*");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/javascript;charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toContain("console.log(1)");
  });

  test("an unhashed asset revalidates daily", async () => {
    const res = await get("/styles.css", "*/*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  test("the unhashed boot shim is served as JS and must revalidate", async () => {
    const res = await get("/boot.js", "*/*");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/javascript;charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("a malformed path falls back to the SPA for HTML requests", async () => {
    const res = await get("/%");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("roxysu-ui");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });

  test("a malformed path is 404 for non-HTML requests", async () => {
    const res = await get("/%", "application/json");
    expect(res.status).toBe(404);
  });

  test("traversal cannot escape the static root", async () => {
    // %2f survives URL normalization, so the decode happens in our resolver.
    const res = await get("/%2e%2e%2fsecret.txt", "*/*");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SECRET);

    const fallback = await get("/%2e%2e%2fsecret.txt");
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("roxysu-ui");
  });

  test("unknown API paths stay 404", async () => {
    const res = await get("/api/does-not-exist", "application/json");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
