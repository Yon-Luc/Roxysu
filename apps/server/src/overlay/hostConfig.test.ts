import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import { settings } from "@roxysu/db/schema";
import {
  OVERLAY_HOST_ENABLED_KEY,
  OVERLAY_HOST_OUTPUT_KEY,
  OVERLAY_HOST_RESTART_KEY,
  OVERLAY_HOST_URL_KEY,
} from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { eq } from "drizzle-orm";
import { bindDb } from "../db-runtime";
import { overlayRoutes } from "../routes/overlay";
import {
  overlayHostConfigEtag,
  overlayHostConfigNotModified,
  readOverlayHostConfig,
  type OverlayHostConfig,
} from "./hostConfig";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

const EMPTY: OverlayHostConfig = {
  enabled: true,
  hostUrl: null,
  output: null,
  restartAt: null,
};

async function writeSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function clearHostSettings() {
  await db
    .delete(settings)
    .where(eq(settings.key, OVERLAY_HOST_ENABLED_KEY));
  await db.delete(settings).where(eq(settings.key, OVERLAY_HOST_URL_KEY));
  await db.delete(settings).where(eq(settings.key, OVERLAY_HOST_OUTPUT_KEY));
  await db.delete(settings).where(eq(settings.key, OVERLAY_HOST_RESTART_KEY));
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-host-config-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(overlayRoutes);
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("overlayHostConfigEtag", () => {
  test("is a weak validator over the four fields", () => {
    const etag = overlayHostConfigEtag(EMPTY);
    expect(etag.startsWith('W/"overlay-host-')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
    expect(overlayHostConfigEtag(EMPTY)).toBe(etag);
    expect(overlayHostConfigEtag({ ...EMPTY, enabled: false })).not.toBe(etag);
  });

  test("key order does not change the validator", () => {
    const body: OverlayHostConfig = {
      restartAt: 9,
      output: "DP-4",
      hostUrl: "http://127.0.0.1:4321/#/overlay",
      enabled: true,
    };
    expect(overlayHostConfigEtag(body)).toBe(
      overlayHostConfigEtag({
        enabled: true,
        hostUrl: body.hostUrl,
        output: body.output,
        restartAt: body.restartAt,
      }),
    );
  });
});

describe("overlayHostConfigNotModified", () => {
  const etag = 'W/"overlay-host-abc"';

  test("matches only an identical If-None-Match", () => {
    expect(overlayHostConfigNotModified(etag, etag)).toBe(true);
    expect(overlayHostConfigNotModified(null, etag)).toBe(false);
    expect(overlayHostConfigNotModified('W/"other"', etag)).toBe(false);
    expect(overlayHostConfigNotModified(`${etag}, ${etag}`, etag)).toBe(false);
  });
});

describe("readOverlayHostConfig", () => {
  test("missing rows match the settings readers (enabled, nulls)", async () => {
    await clearHostSettings();
    expect(await readOverlayHostConfig(db)).toEqual(EMPTY);
  });

  test("copies boolean, trim, and finite-number parsing", async () => {
    await writeSetting(OVERLAY_HOST_ENABLED_KEY, "0");
    await writeSetting(
      OVERLAY_HOST_URL_KEY,
      "  http://127.0.0.1:4321/#/overlay?bg=clear  ",
    );
    await writeSetting(OVERLAY_HOST_OUTPUT_KEY, "  DP-4  ");
    await writeSetting(OVERLAY_HOST_RESTART_KEY, "1730000000000");
    expect(await readOverlayHostConfig(db)).toEqual({
      enabled: false,
      hostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear",
      output: "DP-4",
      restartAt: 1730000000000,
    });

    await writeSetting(OVERLAY_HOST_URL_KEY, "   ");
    await writeSetting(OVERLAY_HOST_OUTPUT_KEY, "");
    await writeSetting(OVERLAY_HOST_RESTART_KEY, "nope");
    await writeSetting(OVERLAY_HOST_ENABLED_KEY, "1");
    expect(await readOverlayHostConfig(db)).toEqual({
      enabled: true,
      hostUrl: null,
      output: null,
      restartAt: null,
    });
  });
});

describe("GET /api/overlay/host-config", () => {
  test("returns the four fields with an etag", async () => {
    await clearHostSettings();
    await writeSetting(OVERLAY_HOST_ENABLED_KEY, "0");
    await writeSetting(OVERLAY_HOST_URL_KEY, "http://127.0.0.1:4321/#/overlay");
    await writeSetting(OVERLAY_HOST_OUTPUT_KEY, "DP-4");
    await writeSetting(OVERLAY_HOST_RESTART_KEY, "42");

    const res = await app.handle(
      new Request("http://localhost/api/overlay/host-config"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = (await res.json()) as OverlayHostConfig;
    expect(body).toEqual({
      enabled: false,
      hostUrl: "http://127.0.0.1:4321/#/overlay",
      output: "DP-4",
      restartAt: 42,
    });
    expect(res.headers.get("etag")).toBe(overlayHostConfigEtag(body));
  });

  test("If-None-Match match is a 304 with no body", async () => {
    await clearHostSettings();
    const first = await app.handle(
      new Request("http://localhost/api/overlay/host-config"),
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await app.handle(
      new Request("http://localhost/api/overlay/host-config", {
        headers: { "if-none-match": etag! },
      }),
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");

    const mismatch = await app.handle(
      new Request("http://localhost/api/overlay/host-config", {
        headers: { "if-none-match": 'W/"overlay-host-nope"' },
      }),
    );
    expect(mismatch.status).toBe(200);
    expect(await mismatch.json()).toEqual(EMPTY);
  });
});
