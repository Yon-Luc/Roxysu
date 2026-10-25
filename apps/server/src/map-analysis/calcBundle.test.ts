import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapDanRatings,
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
  settings,
} from "@roxysu/db/client.bun";
import { JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { and, eq } from "drizzle-orm";
import {
  applyCalcBundle,
  buildCalcBundleFileBytes,
  exportCalcBundleEntries,
  getCalcBundleAppliedVersion,
  maybePullCalcBundleOnBoot,
  reworkReplaceAlgorithmsForBoot,
  uploadCalcBundleToHub,
} from "./calcBundle";
import { readShippedCalcBundleFile } from "./calcBundleFile";
import { REWORK_ALGORITHM } from "./computeReworkDan";
import { APP_VERSION } from "../appVersion";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { CALC_BUNDLE_ALGORITHMS } from "./calcBundle";

const SET_ID = "00000000-0000-0000-0000-000000000030";
const MAP_A = "00000000-0000-0000-0000-000000000031";
const MAP_B = "00000000-0000-0000-0000-000000000032";
const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);

let db: Db;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-calcbundle-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));

  await db.insert(beatmapSets).values({
    id: SET_ID,
    onlineId: 1,
    dateAdded: new Date(),
    status: 1,
  });
  await db.insert(beatmaps).values([
    {
      id: MAP_A,
      onlineId: 100,
      setId: SET_ID,
      difficultyName: "A",
      hash: HASH_A,
      rulesetShortName: "mania",
      circleSize: 4,
      status: 1,
      length: 60,
      bpm: 180,
      starRating: 4,
    },
    {
      id: MAP_B,
      onlineId: 101,
      setId: SET_ID,
      difficultyName: "B",
      hash: HASH_B,
      rulesetShortName: "mania",
      circleSize: 4,
      status: 1,
      length: 60,
      bpm: 180,
      starRating: 4,
    },
  ]);

  await db.insert(beatmapDanRatings).values({
    beatmapId: MAP_A,
    algorithm: REWORK_ALGORITHM,
    beatmapHash: HASH_A,
    sunnyStar: 5,
    lnRatio: 0.1,
    columnCount: 4,
    estDiff: "Regular 1 mid",
    error: null,
    updatedAt: new Date(),
  });
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("reworkReplaceAlgorithmsForBoot", () => {
  test("packaged installs replace rework; bun desktop does not", () => {
    expect(reworkReplaceAlgorithmsForBoot({})).toBeUndefined();
    expect(
      reworkReplaceAlgorithmsForBoot({ ROXYSU_DESKTOP: "1" }),
    ).toBeUndefined();
    const replace = reworkReplaceAlgorithmsForBoot({ ROXYSU_PACKAGED: "1" });
    expect(replace?.has(REWORK_ALGORITHM)).toBe(true);
    expect(replace?.has("mania-skill-v1")).toBe(true);
    expect(replace?.has("sunny")).toBe(false);
  });
});

describe("applyCalcBundle", () => {
  test("gap-fills missing rows and skips successful locals", async () => {
    const stats = await applyCalcBundle(db, [
      {
        beatmapHash: HASH_A,
        onlineBeatmapId: 100,
        algorithm: REWORK_ALGORITHM,
        sunnyStar: 9,
        lnRatio: 0.9,
        columnCount: 4,
        estDiff: "SHOULD_NOT_OVERWRITE",
      },
      {
        beatmapHash: HASH_B,
        onlineBeatmapId: 101,
        algorithm: REWORK_ALGORITHM,
        sunnyStar: 6.5,
        lnRatio: 0.2,
        columnCount: 4,
        estDiff: "Regular 2 mid",
      },
      {
        beatmapHash: "ff".repeat(32),
        algorithm: REWORK_ALGORITHM,
        sunnyStar: 1,
        estDiff: "unmatched",
      },
    ]);

    expect(stats.skipped).toBe(1);
    expect(stats.applied).toBe(1);
    expect(stats.unmatched).toBe(1);

    const kept = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(kept?.estDiff).toBe("Regular 1 mid");
    expect(kept?.sunnyStar).toBe(5);

    const filled = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(filled?.estDiff).toBe("Regular 2 mid");
    expect(filled?.sunnyStar).toBe(6.5);
  });

  test("replaceAlgorithms overwrites successful rework", async () => {
    await db
      .insert(beatmapDanRatings)
      .values({
        beatmapId: MAP_A,
        algorithm: REWORK_ALGORITHM,
        beatmapHash: HASH_A,
        sunnyStar: 1,
        lnRatio: 0,
        columnCount: 4,
        estDiff: "old formula",
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
        set: {
          sunnyStar: 1,
          estDiff: "old formula",
          error: null,
          updatedAt: new Date(),
        },
      });

    const stats = await applyCalcBundle(
      db,
      [
        {
          beatmapHash: HASH_A,
          algorithm: REWORK_ALGORITHM,
          sunnyStar: 2.5,
          lnRatio: 0.1,
          columnCount: 4,
          estDiff: "new formula",
        },
      ],
      { replaceAlgorithms: new Set([REWORK_ALGORITHM]) },
    );

    expect(stats.skipped).toBe(0);
    expect(stats.applied).toBe(1);

    const rework = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(rework?.estDiff).toBe("new formula");
    expect(rework?.sunnyStar).toBe(2.5);
  });

  test("replaces failed local rows", async () => {
    await db
      .insert(beatmapDanRatings)
      .values({
        beatmapId: MAP_B,
        algorithm: REWORK_ALGORITHM,
        beatmapHash: HASH_B,
        sunnyStar: null,
        lnRatio: null,
        columnCount: null,
        estDiff: null,
        error: "Boom",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
        set: {
          error: "Boom",
          estDiff: null,
          sunnyStar: null,
          updatedAt: new Date(),
        },
      });

    const stats = await applyCalcBundle(db, [
      {
        beatmapHash: HASH_B,
        algorithm: REWORK_ALGORITHM,
        sunnyStar: 4,
        lnRatio: 0,
        columnCount: 4,
        estDiff: "Regular 0 mid",
      },
    ]);
    expect(stats.applied).toBe(1);

    const row = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(row?.error).toBeNull();
    expect(row?.estDiff).toBe("Regular 0 mid");
  });

  test("skips unknown legacy algorithms", async () => {
    const stats = await applyCalcBundle(db, [
      {
        beatmapHash: HASH_A,
        algorithm: "sunny",
        sunnyStar: 9,
        estDiff: "ignored",
      },
    ]);
    expect(stats.skipped).toBe(1);
    expect(stats.applied).toBe(0);
  });

  test("export includes successful hash-matched rework rows only", async () => {
    const entries = await exportCalcBundleEntries(db);
    const rework = entries.filter((e) => e.algorithm === REWORK_ALGORITHM);
    expect(rework.length).toBeGreaterThan(0);
    expect(rework.every((e) => e.estDiff != null)).toBe(true);
    expect(entries.every((e) => e.algorithm !== "sunny")).toBe(true);
    expect(entries.every((e) => e.algorithm !== "daniel")).toBe(true);
  });
});

describe("uploadCalcBundleToHub", () => {  const realFetch = globalThis.fetch;
  const realHubUrl = process.env.HUB_URL;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realHubUrl === undefined) delete process.env.HUB_URL;
    else process.env.HUB_URL = realHubUrl;
  });

  test("posts the admin bearer only to the configured Hub, never a caller URL", async () => {
    process.env.HUB_URL = "https://configured-hub.test/";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ entryCount: 1, algorithms: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await uploadCalcBundleToHub({
      db,
      token: "admin-token",
      roxysuVersion: "0.0.0-test",
      // A stale or hostile caller passing a URL must have no effect.
      ...({ hubUrl: "https://evil.example" } as object),
    });

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toBe("https://configured-hub.test/admin/calc-bundles");
    }
  });
});

describe("calc bundle file build + boot", () => {
  const realEnv: { [k: string]: string | undefined } = {};
  const envKeys = ["ROXYSU_PACKAGED", "ROXYSU_CALC_BUNDLE_FILE"] as const;
  afterEach(() => {
    for (const key of envKeys) {
      if (realEnv[key] === undefined) delete process.env[key];
      else process.env[key] = realEnv[key];
    }
  });

  function captureEnv() {
    for (const key of envKeys) realEnv[key] = process.env[key];
  }

  test("build produces a valid gzip NDJSON file of stripped entries", async () => {
    const bytes = await buildCalcBundleFileBytes(db, "0.0.0-filetest");
    const text = gunzipSync(bytes).toString("utf8");
    const lines = text.split("\n").filter((line) => line.length > 0);
    const header = JSON.parse(lines[0]);
    expect(header.format).toBe("roxysu-calc-bundle");
    expect(header.roxysuVersion).toBe("0.0.0-filetest");
    expect(header.algorithms).toContain(REWORK_ALGORITHM);
    expect(header.entryCount).toBe(lines.length - 1);

    const exportable = await exportCalcBundleEntries(db);
    expect(header.entryCount).toBe(exportable.length);
    const fileEntries = lines.slice(1).map((line) => JSON.parse(line));
    // Advisory fields do not travel: file entries equal export entries minus
    // onlineBeatmapId and null columns.
    const expected = exportable.map((entry) =>
      JSON.parse(JSON.stringify(entry, (key, value) =>
        key === "onlineBeatmapId" || value === null ? undefined : value)),
    );
    expect(fileEntries).toEqual(expected);
  });

  test("packaged boot applies the shipped file locally and marks applied", async () => {
    captureEnv();
    const version = APP_VERSION;
    const bytes = await buildCalcBundleFileBytes(db, version);
    const bundlePath = path.join(tmpDir, "calc-bundle.ndjson.gz");
    writeFileSync(bundlePath, bytes);
    // Sanity: the built file for this db parses cleanly.
    const read = readShippedCalcBundleFile(bundlePath, version, CALC_BUNDLE_ALGORITHMS);
    expect(read.ok).toBe(true);

    process.env.ROXYSU_PACKAGED = "1";
    process.env.ROXYSU_CALC_BUNDLE_FILE = bundlePath;

    await maybePullCalcBundleOnBoot(db);

    expect(await getCalcBundleAppliedVersion(db)).toBe(version);

    const replaced = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    const fileEntry = read.ok
      ? read.entries.find(
          (e) =>
            e.beatmapHash === HASH_A && e.algorithm === REWORK_ALGORITHM,
        )
      : undefined;
    expect(fileEntry).toBeDefined();
    expect(replaced?.sunnyStar).toBe(fileEntry!.sunnyStar);
    expect(replaced?.estDiff).toBe(fileEntry!.estDiff);
  });

  test("packaged boot without a usable file marks applied and keeps rows", async () => {
    captureEnv();
    const version = APP_VERSION;
    // Reset the applied marker so the boot path runs again.
    await db
      .insert(settings)
      .values({ key: JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY, value: "" })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: "" },
      });

    process.env.ROXYSU_PACKAGED = "1";
    process.env.ROXYSU_CALC_BUNDLE_FILE = path.join(tmpDir, "missing.ndjson.gz");

    await maybePullCalcBundleOnBoot(db);
    expect(await getCalcBundleAppliedVersion(db)).toBe(version);

    // Prior rows survive untouched.
    const kept = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(kept?.estDiff).not.toBeNull();
  });
});
