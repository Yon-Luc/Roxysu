import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "../db-runtime";
import { settingsRoutes } from "./settings";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

type OverlaySettings = {
  enabled: boolean;
  hostUrl: string | null;
  output: string | null;
  restartAt: number | null;
};

async function patch(
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request("http://localhost/api/settings/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function getOverlay(): Promise<OverlaySettings> {
  const res = await app.handle(new Request("http://localhost/api/settings/"));
  return (await res.json()).overlay;
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-settings-patch-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(settingsRoutes);
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PATCH /settings atomicity (S-NEW-2)", () => {
  test("an invalid monitor 400s without enabling the overlay in the same body", async () => {
    await patch({ overlayEnabled: false });
    const res = await patch({
      overlayEnabled: true,
      overlayOutput: "--follow-focus=false",
    });
    expect(res.status).toBe(400);
    expect((await getOverlay()).enabled).toBe(false);
  });

  test("an invalid URL 400s without persisting the monitor in the same body", async () => {
    const res = await patch({
      overlayOutput: "DP-4",
      overlayHostUrl: "file:///etc/passwd",
    });
    expect(res.status).toBe(400);
    expect((await getOverlay()).output).toBeNull();
  });

  test("a valid combined body persists enable, monitor, and URL together", async () => {
    const res = await patch({
      overlayEnabled: true,
      overlayOutput: "DP-4",
      overlayHostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear&profile=Classic",
    });
    expect(res.status).toBe(200);
    expect(res.body.overlay).toMatchObject({
      enabled: true,
      output: "DP-4",
      hostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear&profile=Classic",
    });
    expect(await getOverlay()).toMatchObject({
      enabled: true,
      output: "DP-4",
      hostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear&profile=Classic",
    });
  });

  test("null output deletes the monitor override (follow osu!)", async () => {
    const res = await patch({ overlayOutput: null });
    expect(res.status).toBe(200);
    expect((await getOverlay()).output).toBeNull();
  });
});

describe("PATCH /settings overlay restart nonce (D-NEW-1)", () => {
  test("restartAt starts unset", async () => {
    expect((await getOverlay()).restartAt).toBeNull();
  });

  test("a restart-only patch bumps the nonce and touches nothing else", async () => {
    const before = await getOverlay();
    const res = await patch({ overlayRestartHost: true });
    expect(res.status).toBe(200);
    const after = res.body.overlay;
    expect(typeof after.restartAt).toBe("number");
    expect(Number.isFinite(after.restartAt)).toBe(true);
    expect(after.restartAt).toBeGreaterThan(0);
    expect(after.enabled).toBe(before.enabled);
    expect(after.hostUrl).toBe(before.hostUrl);
    expect(after.output).toBe(before.output);
    expect((await getOverlay()).restartAt).toBe(after.restartAt);
  });

  test("rapid restart clicks stay strictly monotonic", async () => {
    const first = (await patch({ overlayRestartHost: true })).body.overlay
      .restartAt;
    const second = (await patch({ overlayRestartHost: true })).body.overlay
      .restartAt;
    expect(second).toBeGreaterThan(first);
  });
});
