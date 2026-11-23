import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "../db-runtime";
import { maniaRatingAllowedRoots, settingsRoutes } from "./settings";

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

describe("maniaRatingAllowedRoots", () => {
  test("includes the app data dir, env roots, and documented dev targets", () => {
    const roots = maniaRatingAllowedRoots(
      {
        ROXYSU_DATA_DIR: "/data/roxysu",
        ROXYSU_RESOURCES: "/opt/roxysu/resources",
        ROXYSU_CALCULATOR_ROOTS: ["/opt/calculators", "/srv/calc"].join(
          path.delimiter,
        ),
        HOME: "/home/player",
      } as NodeJS.ProcessEnv,
      path.resolve(process.cwd(), "../.."),
    );
    expect(roots).toContain(path.resolve("/data/roxysu/calculators"));
    expect(roots).toContain(path.resolve("/data/roxysu/mania-rating"));
    expect(roots).toContain(path.resolve("/opt/roxysu/resources/tools"));
    expect(roots).toContain(path.resolve("/opt/calculators"));
    expect(roots).toContain(path.resolve("/srv/calc"));
    expect(roots).toContain(path.resolve("/home/player/roxysu-calc"));
    expect(roots).toContain(path.resolve(process.cwd(), "../../dist"));
  });
});

describe("PATCH /settings executable path hardening (H2)", () => {
  test("rejects a mania-rating binary outside the allowed roots", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-mania-exec-"));
    const binary = path.join(dir, "mania-rating-calc");
    writeFileSync(binary, "");
    chmodSync(binary, 0o755);
    try {
      const res = await patch({
        maniaRatingExecutables: {
          "enissay-accuracy-change": binary,
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Executable path is not inside an allowed directory",
      );
      const settings = await app.handle(
        new Request("http://localhost/api/settings/"),
      );
      const payload = await settings.json();
      const version = payload.maniaRating.versions.find(
        (v: { id: string }) => v.id === "enissay-accuracy-change",
      );
      expect(version.executablePath).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a tosu binary in a temporary directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-tosu-exec-"));
    const binary = path.join(dir, "tosu");
    writeFileSync(binary, "");
    chmodSync(binary, 0o755);
    try {
      const res = await patch({ tosuExecutablePath: binary });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Executable must not live in a temporary directory",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a tosu binary without an execute bit", async () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(path.join(process.cwd(), ".tosu-exec-test-"));
    const binary = path.join(dir, "tosu");
    writeFileSync(binary, "");
    chmodSync(binary, 0o644);
    try {
      const res = await patch({ tosuExecutablePath: binary });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "Executable is not runnable (missing execute permission)",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
