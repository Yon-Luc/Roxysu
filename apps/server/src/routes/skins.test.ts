import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { realmSkinFiles, realmSkins } from "@roxysu/db/schema";
import type { Db } from "@roxysu/db/types";
import { fileURLToPath } from "node:url";

import { bindDb } from "../db-runtime";
import { skinRoutes } from "./skins";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(
  here,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

const SKIN_ID = "skin-1";
const INI_HASH = "c".repeat(64);
const PNG_HASH = "d".repeat(64);
const INI_TEXT = "[General]\nName: Test skin\n[Mania]\nKeys: 4\n";

let db: Db;
let osuDir: string;
function makeApp() {
  return new Elysia().use(skinRoutes);
}
let app: ReturnType<typeof makeApp>;

function lazerFile(hash: string, bytes: string | Uint8Array): void {
  const file = path.join(osuDir, "files", hash[0]!, hash.slice(0, 2), hash);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), "roxysu-skins-"));
  osuDir = path.join(root, "osu");
  process.env.OSU_DATA_PATH = osuDir;
  lazerFile(INI_HASH, INI_TEXT);
  lazerFile(PNG_HASH, new Uint8Array([1, 2, 3, 4]));

  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  db.insert(realmSkins)
    .values({
      id: SKIN_ID,
      name: " Test skin ",
      creator: "mapper",
      hasSkinIni: true,
      syncedAt: new Date(),
    })
    .run();
  db.insert(realmSkinFiles)
    .values([
      { skinId: SKIN_ID, filename: "skin.ini", fileHash: INI_HASH },
      { skinId: SKIN_ID, filename: "hitcircle.png", fileHash: PNG_HASH },
      // Untrusted path: must not escape the archive root.
      { skinId: SKIN_ID, filename: "../../escape.png", fileHash: PNG_HASH },
    ])
    .run();

  bindDb(db);
  app = makeApp();
});

afterAll(() => {
  delete process.env.OSU_DATA_PATH;
  closeDb(db);
  rmSync(path.dirname(osuDir), { recursive: true, force: true });
});

describe("GET /skins", () => {
  test("summarizes from async skin.ini reads", async () => {
    const res = await app.handle(new Request("http://localhost/skins"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: string;
        name: string;
        hasAssets: boolean;
        keyCounts: number[];
      }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: SKIN_ID,
      name: "Test skin",
      hasAssets: true,
      keyCounts: [4],
    });
  });
});

describe("GET /skins/:id/archive", () => {
  test("zips sanitized entries and serves a repeatable archive", async () => {
    const first = await app.handle(
      new Request(`http://localhost/skins/${SKIN_ID}/archive`),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/zip");
    expect(first.headers.get("content-disposition")).toBe(
      'attachment; filename="Test skin.osk"',
    );
    const bytes = new Uint8Array(await first.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(["hitcircle.png", "skin.ini"]);
    expect(new TextDecoder().decode(entries["skin.ini"]!)).toContain("Keys: 4");

    const second = await app.handle(
      new Request(`http://localhost/skins/${SKIN_ID}/archive`),
    );
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(bytes);
  });

  test("unknown skins stay 404", async () => {
    const res = await app.handle(
      new Request("http://localhost/skins/missing/archive"),
    );
    expect(res.status).toBe(404);
  });
});
