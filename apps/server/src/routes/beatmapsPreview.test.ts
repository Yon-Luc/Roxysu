import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import {
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
} from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";

import { beatmapRoutes } from "./beatmaps";
import { bindDb } from "../db-runtime";

const SET_ID = "00000000-0000-0000-0000-000000000030";
const MAP_ID = "00000000-0000-0000-0000-000000000031";
const HASH = "bb".repeat(32);

let db: Db;
let tmpDir: string;

function makeApp() {
  return new Elysia().use(beatmapRoutes);
}
let app: ReturnType<typeof makeApp>;

function maniaOsuText(): string {
  // 4K rice stream: one note per column per beat so Invert yields LNs.
  const lines = [
    "osu file format v14",
    "[General]",
    "Mode: 3",
    "[Metadata]",
    "Title: preview fixture",
    "Artist: tester",
    "Version: 4K",
    "[Difficulty]",
    "CircleSize: 4",
    "OverallDifficulty: 8",
    "[TimingPoints]",
    "0,500,4,2,0,60,1,0",
    "[HitObjects]",
  ];
  let t = 0;
  for (let i = 0; i < 16; i += 1) {
    const col = i % 4;
    // x centers per column: parser maps trunc(x * 4 / 512) → col.
    const x = col * 128 + 64;
    lines.push(`${x},192,${t},1,0,0:0:0:0:`);
    t += 500;
  }
  return lines.join("\n");
}

async function getPreview(mods?: string) {
  const query = mods ? `?mods=${encodeURIComponent(mods)}` : "";
  const res = await app.handle(
    new Request(`http://localhost/beatmaps/${MAP_ID}/preview${query}`),
  );
  return (await res.json()) as {
    supported: boolean;
    appliedMods?: string[];
    columnCount?: number;
    notes: Array<{ column: number; startMs: number; endMs: number }>;
    error?: string;
  };
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-preview-mods-"));
  const osuDir = path.join(tmpDir, "osu");
  const filePath = path.join(
    osuDir,
    "files",
    HASH[0]!,
    HASH.slice(0, 2),
    HASH,
  );
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, maniaOsuText());
  process.env.OSU_DATA_PATH = osuDir;

  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);

  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();
  db.insert(beatmaps)
    .values({
      id: MAP_ID,
      setId: SET_ID,
      onlineId: 101,
      hash: HASH,
      status: 2,
      length: 10,
      bpm: 120,
      starRating: 3,
      rulesetShortName: "mania",
      circleSize: 4,
    })
    .run();

  app = new Elysia().use(beatmapRoutes);
});

afterAll(() => {
  delete process.env.OSU_DATA_PATH;
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /beatmaps/:id/preview mods", () => {
  test("no mods returns raw rice chart", async () => {
    const payload = await getPreview();
    expect(payload.supported).toBe(true);
    expect(payload.appliedMods).toEqual([]);
    expect(payload.notes.every((n) => n.endMs === n.startMs)).toBe(true);
    expect(payload.notes).toHaveLength(16);
  });

  test("?mods=IN converts to full-LN", async () => {
    const payload = await getPreview("IN");
    expect(payload.appliedMods).toEqual(["IN"]);
    const holds = payload.notes.filter((n) => n.endMs > n.startMs);
    expect(holds.length).toBeGreaterThan(0);
    // Same-column starts are 2000ms apart, beat length 500 →
    // tail max(2000/2, 2000 − 500/4) = 1875ms.
    const firstCol0 = payload.notes.find((n) => n.column === 0)!;
    expect(firstCol0.endMs - firstCol0.startMs).toBe(1875);
  });

  test("?mods=HO flattens every note to rice", async () => {
    const payload = await getPreview("HO");
    expect(payload.appliedMods).toEqual(["HO"]);
    expect(payload.notes.length).toBeGreaterThan(0);
    expect(payload.notes.every((n) => n.endMs <= n.startMs)).toBe(true);
  });

  test("?mods=MR flips columns", async () => {
    const [nm, mirrored] = await Promise.all([getPreview(), getPreview("MR")]);
    expect(mirrored.appliedMods).toEqual(["MR"]);
    const flip = (col: number) => 4 - 1 - col;
    expect(mirrored.notes.map((n) => n.column)).toEqual(
      nm.notes.map((n) => flip(n.column)),
    );
  });

  test("unsupported acronyms are dropped", async () => {
    const payload = await getPreview("DT,HD,XX");
    expect(payload.appliedMods).toEqual([]);
    expect(payload.notes.every((n) => n.endMs === n.startMs)).toBe(true);
  });

  test("combined IN+HO nets rice", async () => {
    const payload = await getPreview("IN,HO");
    expect(payload.appliedMods).toEqual(["IN", "HO"]);
    expect(payload.notes.every((n) => n.endMs <= n.startMs)).toBe(true);
  });
});

describe("GET /beatmaps/:id/sunny-dan mods", () => {
  async function getSunnyDan(mods?: string, rate?: number) {
    const search = new URLSearchParams();
    if (mods) search.set("mods", mods);
    if (rate != null) search.set("rate", String(rate));
    const qs = search.toString();
    const res = await app.handle(
      new Request(`http://localhost/beatmaps/${MAP_ID}/sunny-dan${qs ? `?${qs}` : ""}`),
    );
    return (await res.json()) as {
      sunnyDan?: {
        sunnyStar: number | null;
        lnRatio: number | null;
        columnCount: number | null;
        estDiff: string | null;
        error: string | null;
      } | null;
      error?: string;
    };
  }

  test("base combo returns a rated map", async () => {
    const { sunnyDan, error } = await getSunnyDan();
    expect(error).toBeUndefined();
    expect(sunnyDan?.error).toBeNull();
    expect(sunnyDan?.columnCount).toBe(4);
    expect(sunnyDan?.estDiff).toBeTruthy();
    expect(sunnyDan?.lnRatio).toBeLessThan(0.2);
  });

  test("mods=IN rates the full-LN conversion", async () => {
    const { sunnyDan } = await getSunnyDan("IN");
    expect(sunnyDan?.error).toBeNull();
    // Fixture converts every remaining note to an LN → LN table label.
    expect(sunnyDan?.lnRatio).toBe(1);
    expect(sunnyDan?.sunnyStar).not.toBeNull();
  });

  test("mods=IN,HO nets back to rice rating", async () => {
    const { sunnyDan } = await getSunnyDan("IN,HO");
    expect(sunnyDan?.error).toBeNull();
    expect(sunnyDan?.lnRatio).toBeLessThan(0.2);
  });

  test("unknown acronyms are ignored (NM-equivalent)", async () => {
    const base = await getSunnyDan();
    const dtHd = await getSunnyDan("DT,HD");
    expect(dtHd.sunnyDan?.estDiff).toBe(base.sunnyDan?.estDiff);
  });

  test("missing beatmap 404s", async () => {
    const res = await app.handle(
      new Request(
        "http://localhost/beatmaps/00000000-0000-0000-0000-00000000dead/sunny-dan",
      ),
    );
    expect(res.status).toBe(404);
  });
});
