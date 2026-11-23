import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "../db-runtime";
import {
  MAX_OVERLAY_PROFILE_BODY,
  MAX_OVERLAY_SKIN_SPRITES,
  MAX_OVERLAY_SPRITE_CHARS,
  overlayRoutes,
} from "./overlay";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

async function request(
  pathname: string,
  init: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: { "content-type": "application/json" },
    }),
  );
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-overlay-limits-"));
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

describe("overlay profile schema", () => {
  test("accepts a legacy payload and still sanitizes it", async () => {
    const res = await request("/api/overlay/profiles/main", {
      method: "PUT",
      body: JSON.stringify({
        name: "Main",
        width: "1920",
        height: 1080,
        bg: "clear",
        extraTopLevel: "ignored",
        elements: [
          {
            instanceId: "scores",
            type: "scoreList",
            x: 12,
            y: 12,
            scale: 1,
            options: { limit: 8 },
            trigger: null,
            extraElementField: true,
          },
          { instanceId: "bogus", type: "not-a-widget", x: 0, y: 0, scale: 1 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      id: "main",
      name: "Main",
      width: 1920,
      height: 1080,
      bg: "clear",
    });
    expect(res.body.profile.elements).toHaveLength(1);
    expect(res.body.profile.elements[0].type).toBe("scoreList");
  });

  test("rejects a profile whose serialized body exceeds the cap", async () => {
    const res = await request("/api/overlay/profiles/huge", {
      method: "PUT",
      body: JSON.stringify({
        name: "Huge",
        elements: [
          {
            instanceId: "scores",
            type: "scoreList",
            x: 0,
            y: 0,
            scale: 1,
            options: { blob: "x".repeat(MAX_OVERLAY_PROFILE_BODY + 1) },
          },
        ],
      }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("overlay profile is too large");
  });
});

describe("overlay skin snapshot bounds", () => {
  test("stores bounded sprite data URLs and truncates long keys", async () => {
    const png = "data:image/png;base64," + Buffer.from("hello").toString("base64");
    const longKey = "k".repeat(200);
    const res = await request("/api/overlay/skins", {
      method: "PUT",
      body: JSON.stringify({ sprites: { sprite: png, [longKey]: png } }),
    });
    expect(res.status).toBe(200);

    const snapshot = await request("/api/overlay/skins", { method: "GET" });
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.snapshot.sprites.sprite).toBe(png);
    expect(snapshot.body.snapshot.sprites["k".repeat(128)]).toBe(png);
    expect(Object.keys(snapshot.body.snapshot.sprites)).toHaveLength(2);

    const sprite = await app.handle(
      new Request("http://localhost/api/overlay/skins/sprites/sprite"),
    );
    expect(sprite.status).toBe(200);
    expect(await sprite.text()).toBe("hello");
  });

  test("rejects more than the sprite count cap", async () => {
    const png = "data:image/png;base64,aGk=";
    const sprites: Record<string, string> = {};
    for (let i = 0; i <= MAX_OVERLAY_SKIN_SPRITES; i += 1) {
      sprites[`s${i}`] = png;
    }
    const res = await request("/api/overlay/skins", {
      method: "PUT",
      body: JSON.stringify({ sprites }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain(String(MAX_OVERLAY_SKIN_SPRITES));
  });

  test("rejects a single oversized sprite", async () => {
    const res = await request("/api/overlay/skins", {
      method: "PUT",
      body: JSON.stringify({
        sprites: {
          huge:
            "data:image/png;base64," +
            "A".repeat(MAX_OVERLAY_SPRITE_CHARS),
        },
      }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain("too large");
  });

  test("rejects a snapshot whose sprites exceed the total cap", async () => {
    const chunk = "data:image/png;base64," + "A".repeat(7_000_000);
    const sprites: Record<string, string> = {};
    for (let i = 0; i < 5; i += 1) sprites[`s${i}`] = chunk;
    const res = await request("/api/overlay/skins", {
      method: "PUT",
      body: JSON.stringify({ sprites }),
    });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("overlay skin snapshot is too large");
  });
});
