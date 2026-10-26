import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapDanRatings,
  beatmapPatternAnalysis,
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
  dropCalcBundleLeftovers,
  exportCalcBundleEntries,
  getCalcBundleAppliedVersion,
  maybePullCalcBundleOnBoot,
  reworkReplaceAlgorithmsForBoot,
  uploadCalcBundleToHub,
} from "./calcBundle";
import { readShippedCalcBundleFile } from "./calcBundleFile";
import { REWORK_ALGORITHM, clearStoredReworkSync } from "./computeReworkDan";
import { PATTERN_ALGORITHM } from "./computePatternAnalysis";
import { getReworkDanJobStatus } from "./reworkDanJob";
import { subscribe as subscribeEvents, type AppEvent } from "../shared/events";
import { APP_VERSION } from "../appVersion";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { CALC_BUNDLE_ALGORITHMS } from "./calcBundle";

const SET_ID = "00000000-0000-0000-0000-000000000030";
const MAP_A = "00000000-0000-0000-0000-000000000031";
const MAP_B = "00000000-0000-0000-0000-000000000032";
const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);
const MAP_C = "00000000-0000-0000-0000-000000000033";
const HASH_C = "ef".repeat(32);

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

describe("dropCalcBundleLeftovers", () => {
  beforeAll(async () => {
    // Drop tests, like the boot below, insert rows that reference MAP_C.
    await db
      .insert(beatmaps)
      .values({
        id: MAP_C,
        onlineId: 102,
        setId: SET_ID,
        difficultyName: "C",
        hash: HASH_C,
        rulesetShortName: "mania",
        circleSize: 4,
        status: 1,
        length: 60,
        bpm: 180,
        starRating: 4,
      })
      .onConflictDoNothing();
  });

  test("deletes only rows whose hash (or null hash) the entries do not cover", async () => {
    // Reset this describe's fixture rows.
    clearStoredReworkSync(db);
    const FILE_DAN = {
      beatmapId: MAP_A,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: HASH_A,
      sunnyStar: 5,
      lnRatio: 0.1,
      columnCount: 4,
      estDiff: "Regular 1 mid",
      error: null,
      updatedAt: new Date(),
    };
    await db.insert(beatmapDanRatings).values(FILE_DAN);
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_A,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: HASH_A,
      dominantPattern: "stream",
      confidence: 0.6,
      columnCount: 4,
      error: null,
      updatedAt: new Date(),
    });
    // Not covered by the entries below.
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_B,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: HASH_B,
      sunnyStar: 4,
      columnCount: 4,
      estDiff: "STALE_B",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_B,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: HASH_B,
      dominantPattern: "jack",
      error: null,
      updatedAt: new Date(),
    });
    // A null hash cannot be vouched for by a file either.
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_C,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: null,
      sunnyStar: 3,
      columnCount: 4,
      estDiff: "STALE_NULL",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_C,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: null,
      dominantPattern: "trill",
      error: null,
      updatedAt: new Date(),
    });

    const dropped = await dropCalcBundleLeftovers(db, [
      {
        beatmapHash: HASH_A,
        algorithm: REWORK_ALGORITHM,
        sunnyStar: 5,
        estDiff: "Regular 1 mid",
      },
      {
        beatmapHash: HASH_A,
        algorithm: PATTERN_ALGORITHM,
        dominantPattern: "stream",
      },
    ]);

    expect(dropped).toBe(4);
    const coveredA = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_A),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(coveredA?.estDiff).toBe("Regular 1 mid");
    const staleB = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(staleB).toBeUndefined();
    const staleBPattern = await db
      .select()
      .from(beatmapPatternAnalysis)
      .where(
        and(
          eq(beatmapPatternAnalysis.beatmapId, MAP_B),
          eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        ),
      )
      .get();
    expect(staleBPattern).toBeUndefined();
    const nullHashC = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_C),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(nullHashC).toBeUndefined();

    // Leave the shared fixture clean for later describes.
    await db.delete(beatmapDanRatings);
    await db.delete(beatmapPatternAnalysis);
  });
});

describe("calc bundle version bump drop boot", () => {
  const realEnv: { [k: string]: string | undefined } = {};
  const realFetch = globalThis.fetch;
  const envKeys = [
    "ROXYSU_PACKAGED",
    "ROXYSU_CALC_BUNDLE_FILE",
    "HUB_URL",
  ] as const;
  afterEach(() => {
    for (const key of envKeys) {
      if (realEnv[key] === undefined) delete process.env[key];
      else process.env[key] = realEnv[key];
    }
    globalThis.fetch = realFetch;
  });

  function captureEnv() {
    for (const key of envKeys) realEnv[key] = process.env[key];
  }

  async function resetAppliedMarker(): Promise<void> {
    await db
      .insert(settings)
      .values({ key: JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY, value: "" })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: "" },
      });
  }

  let events: AppEvent[];
  let unsubscribe: (() => void) | null;
  beforeEach(() => {
    events = [];
    unsubscribe = subscribeEvents((event) => events.push(event));
  });
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  test("packaged boot replaces covered rows, drops leftovers, and publishes the applied event", async () => {
    captureEnv();
    await resetAppliedMarker();
    await db.insert(beatmaps).values({
      id: MAP_C,
      onlineId: 102,
      setId: SET_ID,
      difficultyName: "C",
      hash: HASH_C,
      rulesetShortName: "mania",
      circleSize: 4,
      status: 1,
      length: 60,
      bpm: 180,
      starRating: 4,
    }).onConflictDoNothing();
    clearStoredReworkSync(db);

    // The file's authority for MAP_A; everything else is a leftover.
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
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_A,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: HASH_A,
      dominantPattern: "stream",
      confidence: 0.6,
      columnCount: 4,
      error: null,
      updatedAt: new Date(),
    });

    const bytes = await buildCalcBundleFileBytes(db, APP_VERSION);
    const bundlePath = path.join(tmpDir, "calc-bundle-drop.ndjson.gz");
    writeFileSync(bundlePath, bytes);

    // Rows changed after the file was built must be replaced back by apply.
    await db
      .insert(beatmapDanRatings)
      .values({
        beatmapId: MAP_A,
        algorithm: REWORK_ALGORITHM,
        beatmapHash: HASH_A,
        sunnyStar: 9,
        columnCount: 4,
        estDiff: "tampered dan",
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
        set: { sunnyStar: 9, estDiff: "tampered dan", updatedAt: new Date() },
      });
    await db
      .insert(beatmapPatternAnalysis)
      .values({
        beatmapId: MAP_A,
        algorithm: PATTERN_ALGORITHM,
        beatmapHash: HASH_A,
        dominantPattern: "chordjack",
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          beatmapPatternAnalysis.beatmapId,
          beatmapPatternAnalysis.algorithm,
        ],
        set: { dominantPattern: "chordjack", error: null, updatedAt: new Date() },
      });
    // Stale local rows the shipped file does not vouch for.
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_B,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: HASH_B,
      sunnyStar: 4,
      columnCount: 4,
      estDiff: "STALE_B",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_B,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: HASH_B,
      dominantPattern: "jack",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_C,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: null,
      sunnyStar: 3,
      columnCount: 4,
      estDiff: "STALE_NULL",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_C,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: null,
      dominantPattern: "trill",
      error: null,
      updatedAt: new Date(),
    });

    process.env.ROXYSU_PACKAGED = "1";
    process.env.ROXYSU_CALC_BUNDLE_FILE = bundlePath;

    const boot = await maybePullCalcBundleOnBoot(db);

    expect(boot?.state.status).toBe("completed");
    expect(boot?.droppedLeftovers).toBe(4);
    expect(await getCalcBundleAppliedVersion(db)).toBe(APP_VERSION);
    expect(
      events.filter((event) => event.type === "calc-bundle.applied").length,
    ).toBe(1);
    // The bundled rework entry replaced the tampered row.
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
    expect(replaced?.estDiff).toBe("Regular 1 mid");
    expect(replaced?.sunnyStar).toBe(5);
    const replacedPattern = await db
      .select()
      .from(beatmapPatternAnalysis)
      .where(
        and(
          eq(beatmapPatternAnalysis.beatmapId, MAP_A),
          eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        ),
      )
      .get();
    expect(replacedPattern?.dominantPattern).toBe("stream");
    // Leftovers are gone, for both algorithms.
    for (const beatmapId of [MAP_B, MAP_C]) {
      const dan = await db
        .select()
        .from(beatmapDanRatings)
        .where(eq(beatmapDanRatings.beatmapId, beatmapId))
        .all();
      expect(dan).toEqual([]);
      const pattern = await db
        .select()
        .from(beatmapPatternAnalysis)
        .where(eq(beatmapPatternAnalysis.beatmapId, beatmapId))
        .all();
      expect(pattern).toEqual([]);
    }
    // Starting the backfill is the entry point's job, not the bundle's.
    expect(getReworkDanJobStatus()).not.toBe("running");

    // Leave a clean slate for the next test.
    await db.delete(beatmapDanRatings);
    await db.delete(beatmapPatternAnalysis);
  });

  test("dev boot (Hub gap-fill) never drops rows", async () => {
    captureEnv();
    await resetAppliedMarker();
    await db.insert(beatmapDanRatings).values({
      beatmapId: MAP_B,
      algorithm: REWORK_ALGORITHM,
      beatmapHash: HASH_B,
      sunnyStar: 4,
      columnCount: 4,
      estDiff: "STALE_B",
      error: null,
      updatedAt: new Date(),
    });
    await db.insert(beatmapPatternAnalysis).values({
      beatmapId: MAP_B,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: HASH_B,
      dominantPattern: "jack",
      error: null,
      updatedAt: new Date(),
    });

    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          entries: [
            {
              beatmapHash: HASH_A,
              algorithm: REWORK_ALGORITHM,
              sunnyStar: 5,
              lnRatio: 0.1,
              columnCount: 4,
              estDiff: "Regular 1 mid",
            },
          ],
          entryCount: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    process.env.HUB_URL = "https://configured-hub.test/";

    const boot = await maybePullCalcBundleOnBoot(db);

    expect(urls[0]).toBe(
      `https://configured-hub.test/calc-bundles/${encodeURIComponent(APP_VERSION)}`,
    );
    expect(boot?.state.status).toBe("completed");
    expect(boot?.droppedLeftovers).toBe(0);
    // Stale rows are kept on the gap-fill path.
    const stale = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, MAP_B),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .get();
    expect(stale?.estDiff).toBe("STALE_B");
    // No rework replacing came from the bundle file path.
    expect(
      events.filter((event) => event.type === "calc-bundle.applied").length,
    ).toBe(0);
  });
});
