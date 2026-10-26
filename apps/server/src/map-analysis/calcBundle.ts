import {
  beatmapDanRatings,
  beatmapPatternAnalysis,
  beatmaps,
  settings,
} from "@roxysu/db/schema";
import { JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { gzipSync } from "node:zlib";
import { resolveHubBaseUrl } from "../hubUrl";
import { APP_VERSION } from "../appVersion";
import { publish } from "../shared/events";
import { REWORK_ALGORITHM } from "./computeReworkDan";
import { PATTERN_ALGORITHM, nullIllegalShapeLabels } from "./computePatternAnalysis";
import {
  CALC_BUNDLE_FILE_FORMAT,
  type CalcBundleFileHeader,
  readShippedCalcBundleFile,
  serializeCalcBundleFileEntry,
  serializeCalcBundleFileHeader,
} from "./calcBundleFile";

export const CALC_BUNDLE_ALGORITHMS = [
  REWORK_ALGORITHM,
  PATTERN_ALGORITHM,
] as const;

export const CALC_BUNDLE_CHUNK_SIZE = 1_500;

const DAN_ALGORITHMS = new Set<string>([REWORK_ALGORITHM]);

const HUB_TIMEOUT_MS = 60_000;
const HUB_CIRCUIT_COOLDOWN_MS = 30_000;

export type CalcBundleEntry = {
  beatmapHash: string;
  onlineBeatmapId?: number | null;
  algorithm: string;
  sunnyStar?: number | null;
  lnRatio?: number | null;
  columnCount?: number | null;
  estDiff?: string | null;
  dominantPattern?: string | null;
  secondaryPattern?: string | null;
  shapePattern?: string | null;
  secondaryShape?: string | null;
  confidence?: number | null;
  jackDensity?: number | null;
  chordDensity?: number | null;
  streamDensity?: number | null;
  bracketDensity?: number | null;
  chordjackScore?: number | null;
  jumpstreamScore?: number | null;
  chordstreamScore?: number | null;
};

export type CalcBundlePullStatus =
  | "idle"
  | "running"
  | "completed"
  | "error"
  | "skipped";

export type CalcBundlePullSource = "hub" | "file";

export type CalcBundlePullState = {
  status: CalcBundlePullStatus;
  source: CalcBundlePullSource | null;
  version: string | null;
  applied: number;
  skipped: number;
  unmatched: number;
  entryCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

let pullState: CalcBundlePullState = {
  status: "idle",
  source: null,
  version: null,
  applied: 0,
  skipped: 0,
  unmatched: 0,
  entryCount: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
};

let hubCircuitOpenUntil = 0;

export function getCalcBundlePullState(): CalcBundlePullState {
  return { ...pullState };
}

function setPullState(patch: Partial<CalcBundlePullState>) {
  pullState = { ...pullState, ...patch };
  publish({ type: "jobs.updated" });
}

async function readSetting(db: Db, key: string): Promise<string | null> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function getCalcBundleAppliedVersion(
  db: Db,
): Promise<string | null> {
  return readSetting(db, JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY);
}

export async function setCalcBundleAppliedVersion(
  db: Db,
  version: string,
): Promise<void> {
  await writeSetting(db, JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY, version);
}

/**
 * Stream successful local rows for release/Hub export (dan rows first, then
 * pattern rows; queries are single-pass, so pagination needs no ORDER BY).
 */
export async function* iterateCalcBundleEntries(
  db: Db,
): AsyncGenerator<CalcBundleEntry> {
  const danRows = await db
    .select({
      beatmapHash: beatmaps.hash,
      onlineBeatmapId: beatmaps.onlineId,
      algorithm: beatmapDanRatings.algorithm,
      sunnyStar: beatmapDanRatings.sunnyStar,
      lnRatio: beatmapDanRatings.lnRatio,
      columnCount: beatmapDanRatings.columnCount,
      estDiff: beatmapDanRatings.estDiff,
    })
    .from(beatmapDanRatings)
    .innerJoin(beatmaps, eq(beatmaps.id, beatmapDanRatings.beatmapId))
    .where(
      and(
        eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        isNotNull(beatmaps.hash),
        isNull(beatmapDanRatings.error),
        isNotNull(beatmapDanRatings.estDiff),
        sql`${beatmapDanRatings.beatmapHash} = ${beatmaps.hash}`,
      ),
    );

  const patternRows = await db
    .select({
      beatmapHash: beatmaps.hash,
      onlineBeatmapId: beatmaps.onlineId,
      algorithm: beatmapPatternAnalysis.algorithm,
      columnCount: beatmapPatternAnalysis.columnCount,
      dominantPattern: beatmapPatternAnalysis.dominantPattern,
      secondaryPattern: beatmapPatternAnalysis.secondaryPattern,
      shapePattern: beatmapPatternAnalysis.shapePattern,
      secondaryShape: beatmapPatternAnalysis.secondaryShape,
      confidence: beatmapPatternAnalysis.confidence,
      jackDensity: beatmapPatternAnalysis.jackDensity,
      chordDensity: beatmapPatternAnalysis.chordDensity,
      streamDensity: beatmapPatternAnalysis.streamDensity,
      bracketDensity: beatmapPatternAnalysis.bracketDensity,
      chordjackScore: beatmapPatternAnalysis.chordjackScore,
      jumpstreamScore: beatmapPatternAnalysis.jumpstreamScore,
      chordstreamScore: beatmapPatternAnalysis.chordstreamScore,
    })
    .from(beatmapPatternAnalysis)
    .innerJoin(beatmaps, eq(beatmaps.id, beatmapPatternAnalysis.beatmapId))
    .where(
      and(
        eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        isNotNull(beatmaps.hash),
        isNull(beatmapPatternAnalysis.error),
        isNotNull(beatmapPatternAnalysis.dominantPattern),
        sql`${beatmapPatternAnalysis.beatmapHash} = ${beatmaps.hash}`,
      ),
    );

  for (const row of danRows) {
    if (!row.beatmapHash) continue;
    yield {
      beatmapHash: row.beatmapHash,
      onlineBeatmapId: row.onlineBeatmapId,
      algorithm: row.algorithm,
      sunnyStar: row.sunnyStar,
      lnRatio: row.lnRatio,
      columnCount: row.columnCount,
      estDiff: row.estDiff,
    };
  }
  for (const row of patternRows) {
    if (!row.beatmapHash) continue;
    yield {
      beatmapHash: row.beatmapHash,
      onlineBeatmapId: row.onlineBeatmapId,
      algorithm: row.algorithm,
      columnCount: row.columnCount,
      dominantPattern: row.dominantPattern,
      secondaryPattern: row.secondaryPattern,
      shapePattern: row.shapePattern,
      secondaryShape: row.secondaryShape,
      confidence: row.confidence,
      jackDensity: row.jackDensity,
      chordDensity: row.chordDensity,
      streamDensity: row.streamDensity,
      bracketDensity: row.bracketDensity,
      chordjackScore: row.chordjackScore,
      jumpstreamScore: row.jumpstreamScore,
      chordstreamScore: row.chordstreamScore,
    };
  }
}

/** Export successful local rows for Hub upload (skip errors / null labels). */
export async function exportCalcBundleEntries(
  db: Db,
): Promise<CalcBundleEntry[]> {
  const out: CalcBundleEntry[] = [];
  for await (const entry of iterateCalcBundleEntries(db)) {
    out.push(entry);
  }
  return out;
}

/**
 * Build the shipped calc bundle file: gzipped NDJSON, header line first,
 * entries without advisory fields (no `onlineBeatmapId`, no null columns).
 * Throws when the local mirror has no exportable rows.
 */
export async function buildCalcBundleFileBytes(
  db: Db,
  roxysuVersion: string,
): Promise<Buffer> {
  const lines: string[] = [];
  let entryCount = 0;
  for await (const entry of iterateCalcBundleEntries(db)) {
    entryCount++;
    lines.push(serializeCalcBundleFileEntry(entry));
  }
  if (entryCount === 0) {
    throw new Error("No exportable calc bundle rows (run the rework + pattern backfills first)");
  }
  const header: CalcBundleFileHeader = {
    format: CALC_BUNDLE_FILE_FORMAT,
    roxysuVersion,
    algorithms: [...CALC_BUNDLE_ALGORITHMS],
    entryCount,
  };
  lines.unshift(serializeCalcBundleFileHeader(header));
  const text = lines.join("\n") + "\n";
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 });
}

type ApplyStats = { applied: number; skipped: number; unmatched: number };

export type CalcBundleApplyOptions = {
  /**
   * Algorithms whose successful local rows are replaced by the bundle.
   * Omitted algorithms stay gap-fill (missing or failed rows only).
   */
  replaceAlgorithms?: ReadonlySet<string>;
};

/**
 * Packaged installs (Nix `ROXYSU_RESOURCES`, electron-builder) replace rework
 * rows from the shipped calc bundle file on a product-version bump.
 * `bun desktop` does not set `ROXYSU_PACKAGED`, so the dev library is left
 * alone.
 */
export function reworkReplaceAlgorithmsForBoot(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> | undefined {
  if (env.ROXYSU_PACKAGED !== "1") return undefined;
  return new Set([REWORK_ALGORITHM, PATTERN_ALGORITHM]);
}

/**
 * Gap-fill: write bundle entries when the local row is missing or failed.
 * Successful local rows are kept unless `replaceAlgorithms` names that algorithm.
 *
 * Apollo entries are applied in slices — hash lookups and existing-row reads
 * run batched per slice and the slice's writes commit in one transaction, so a
 * full library (~130k entries) stays seconds-level instead of one autocommit
 * statement per entry.
 */
export async function applyCalcBundle(
  db: Db,
  entries: CalcBundleEntry[],
  options?: CalcBundleApplyOptions,
): Promise<ApplyStats> {
  const stats: ApplyStats = { applied: 0, skipped: 0, unmatched: 0 };
  if (entries.length === 0) return stats;

  const SLICE = 4_000;
  for (let i = 0; i < entries.length; i += SLICE) {
    await applyCalcBundleSlice(
      db,
      entries.slice(i, i + SLICE),
      options,
      stats,
    );
  }

  return stats;
}

type MatchedEntry = { entry: CalcBundleEntry; beatmapId: string };

async function resolveLocalByHash(
  db: Db,
  entries: CalcBundleEntry[],
): Promise<Map<string, string>> {
  const hashes = [...new Set(entries.map((e) => e.beatmapHash))];
  const localByHash = new Map<string, string>();
  const HASH_BATCH = 400;
  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const slice = hashes.slice(i, i + HASH_BATCH);
    const rows = await db
      .select({ id: beatmaps.id, hash: beatmaps.hash })
      .from(beatmaps)
      .where(inArray(beatmaps.hash, slice));
    for (const row of rows) {
      if (row.hash) localByHash.set(row.hash, row.id);
    }
  }
  return localByHash;
}

async function readExistingDan(
  db: Db,
  beatmapIds: string[],
): Promise<Map<string, { error: string | null; estDiff: string | null }>> {
  const existing = new Map<string, { error: string | null; estDiff: string | null }>();
  const IDs_BATCH = 900;
  for (let i = 0; i < beatmapIds.length; i += IDs_BATCH) {
    const slice = beatmapIds.slice(i, i + IDs_BATCH);
    const rows = await db
      .select({
        beatmapId: beatmapDanRatings.beatmapId,
        error: beatmapDanRatings.error,
        estDiff: beatmapDanRatings.estDiff,
      })
      .from(beatmapDanRatings)
      .where(
        and(
          inArray(beatmapDanRatings.beatmapId, slice),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      );
    for (const row of rows) existing.set(row.beatmapId, row);
  }
  return existing;
}

async function readExistingPattern(
  db: Db,
  beatmapIds: string[],
): Promise<
  Map<
    string,
    {
      error: string | null;
      dominantPattern: string | null;
      shapePattern: string | null;
    }
  >
> {
  const existing = new Map<
    string,
    { error: string | null; dominantPattern: string | null; shapePattern: string | null }
  >();
  const IDs_BATCH = 900;
  for (let i = 0; i < beatmapIds.length; i += IDs_BATCH) {
    const slice = beatmapIds.slice(i, i + IDs_BATCH);
    const rows = await db
      .select({
        beatmapId: beatmapPatternAnalysis.beatmapId,
        error: beatmapPatternAnalysis.error,
        dominantPattern: beatmapPatternAnalysis.dominantPattern,
        shapePattern: beatmapPatternAnalysis.shapePattern,
      })
      .from(beatmapPatternAnalysis)
      .where(
        and(
          inArray(beatmapPatternAnalysis.beatmapId, slice),
          eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        ),
      );
    for (const row of rows) existing.set(row.beatmapId, row);
  }
  return existing;
}

const now = () => new Date();

/**
 * Delete rows of the bundle algorithms whose `beatmap_hash` is null or not in
 * the shipped file.
 *
 * Packaged replace semantics only: the file is the formula authority for its
 * product version, so a row the file does not vouch for is stale and must not
 * keep showing the previous formula's number on the beatmap page. Dropped maps
 * re-enter the missing backfill instead of being trusted.
 *
 * The hashes go into a temp table first — one `NOT IN (SELECT …)` delete per
 * table instead of a ~130k-parameter `NOT IN` list. Everything runs in one
 * transaction so the counts match the deletes.
 */
export async function dropCalcBundleLeftovers(
  db: Db,
  entries: CalcBundleEntry[],
): Promise<number> {
  const hashes: string[] = [];
  {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!seen.has(entry.beatmapHash)) {
        seen.add(entry.beatmapHash);
        hashes.push(entry.beatmapHash);
      }
    }
  }
  if (hashes.length === 0) return 0;

  /** Drizzle binds ~32k parameters max; keep insert batches far below that. */
  const HASHES_PER_INSERT = 2_000;
  const outsideHashPred =
    sql`(beatmap_hash IS NULL OR beatmap_hash NOT IN (SELECT hash FROM temp.calc_bundle_hashes))`;

  try {
    return db.transaction((tx) => {
      tx.run(sql`DROP TABLE IF EXISTS temp.calc_bundle_hashes`);
      tx.run(sql`CREATE TABLE temp.calc_bundle_hashes (hash TEXT PRIMARY KEY)`);
      for (let i = 0; i < hashes.length; i += HASHES_PER_INSERT) {
        const values = sql.join(
          hashes
            .slice(i, i + HASHES_PER_INSERT)
            .map((hash) => sql`(${hash})`),
          sql`, `,
        );
        tx.run(
          sql`INSERT OR IGNORE INTO temp.calc_bundle_hashes (hash) VALUES ${values}`,
        );
      }
      let dropped = 0;
      for (const algorithm of CALC_BUNDLE_ALGORITHMS) {
        // Count on the raw client — the drizzle bun driver returns positional
        // arrays for raw `SELECT COUNT(*)`, the better-sqlite3 driver objects.
        // The prepared+`.get()` shape is uniform across both.
        const dan = db.$client
          .query(
            `SELECT COUNT(*) AS n FROM beatmap_dan_ratings WHERE algorithm = ? AND (beatmap_hash IS NULL OR beatmap_hash NOT IN (SELECT hash FROM temp.calc_bundle_hashes))`,
          )
          .get(algorithm) as { n: number } | null;
        const pattern = db.$client
          .query(
            `SELECT COUNT(*) AS n FROM beatmap_pattern_analysis WHERE algorithm = ? AND (beatmap_hash IS NULL OR beatmap_hash NOT IN (SELECT hash FROM temp.calc_bundle_hashes))`,
          )
          .get(algorithm) as { n: number } | null;
        dropped += Number(dan?.n ?? 0) + Number(pattern?.n ?? 0);
      }
      for (const algorithm of CALC_BUNDLE_ALGORITHMS) {
        tx.run(
          sql`DELETE FROM beatmap_dan_ratings WHERE algorithm = ${algorithm} AND ${outsideHashPred}`,
        );
        tx.run(
          sql`DELETE FROM beatmap_pattern_analysis WHERE algorithm = ${algorithm} AND ${outsideHashPred}`,
        );
      }
      tx.run(sql`DROP TABLE IF EXISTS temp.calc_bundle_hashes`);
      return dropped;
    });
  } catch (err) {
    console.warn(
      `[calc-bundle] leftover drop failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      db.$client
        .query("DROP TABLE IF EXISTS temp.calc_bundle_hashes")
        .run();
    } catch {
      // temp table cleanup is best-effort
    }
    return 0;
  }
}

async function applyCalcBundleSlice(
  db: Db,
  slice: CalcBundleEntry[],
  options: CalcBundleApplyOptions | undefined,
  stats: ApplyStats,
): Promise<void> {
  const localByHash = await resolveLocalByHash(db, slice);

  const matched: MatchedEntry[] = [];
  const beatmapIds: string[] = [];
  for (const entry of slice) {
    const beatmapId = localByHash.get(entry.beatmapHash);
    if (!beatmapId) {
      stats.unmatched++;
      continue;
    }
    matched.push({ entry, beatmapId });
    beatmapIds.push(beatmapId);
  }
  if (matched.length === 0) return;

  const uniqueBeatmapIds = [...new Set(beatmapIds)];
  const danExisting = await readExistingDan(db, uniqueBeatmapIds);
  const patternExisting = await readExistingPattern(db, uniqueBeatmapIds);

  const writes: MatchedEntry[] = [];
  for (const { entry, beatmapId } of matched) {
    if (DAN_ALGORITHMS.has(entry.algorithm)) {
      const existing = danExisting.get(beatmapId);
      if (
        !options?.replaceAlgorithms?.has(entry.algorithm) &&
        existing &&
        existing.error == null &&
        existing.estDiff != null
      ) {
        stats.skipped++;
        continue;
      }
      writes.push({ entry, beatmapId });
      continue;
    }

    if (entry.algorithm === PATTERN_ALGORITHM) {
      const existing = patternExisting.get(beatmapId);
      if (
        !options?.replaceAlgorithms?.has(PATTERN_ALGORITHM) &&
        existing &&
        existing.error == null &&
        existing.dominantPattern != null &&
        (existing.shapePattern != null || entry.shapePattern == null)
      ) {
        stats.skipped++;
        continue;
      }
      writes.push({ entry, beatmapId });
      continue;
    }

    stats.skipped++;
  }

  if (writes.length === 0) return;

  db.transaction((tx) => {
    for (const { entry, beatmapId } of writes) {
      if (DAN_ALGORITHMS.has(entry.algorithm)) {
        tx
          .insert(beatmapDanRatings)
          .values({
            beatmapId,
            algorithm: entry.algorithm,
            beatmapHash: entry.beatmapHash,
            sunnyStar: entry.sunnyStar ?? null,
            lnRatio: entry.lnRatio ?? null,
            columnCount: entry.columnCount ?? null,
            estDiff: entry.estDiff ?? null,
            error: null,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
            set: {
              beatmapHash: entry.beatmapHash,
              sunnyStar: entry.sunnyStar ?? null,
              lnRatio: entry.lnRatio ?? null,
              columnCount: entry.columnCount ?? null,
              estDiff: entry.estDiff ?? null,
              error: null,
              updatedAt: now(),
            },
          })
          .run();
        continue;
      }

      if (entry.algorithm === PATTERN_ALGORITHM) {
        tx
          .insert(beatmapPatternAnalysis)
          .values({
            beatmapId,
            algorithm: PATTERN_ALGORITHM,
            beatmapHash: entry.beatmapHash,
            columnCount: entry.columnCount ?? null,
            dominantPattern: entry.dominantPattern ?? null,
            secondaryPattern: entry.secondaryPattern ?? null,
            shapePattern: entry.shapePattern ?? null,
            secondaryShape: entry.secondaryShape ?? null,
            confidence: entry.confidence ?? null,
            jackDensity: entry.jackDensity ?? null,
            chordDensity: entry.chordDensity ?? null,
            streamDensity: entry.streamDensity ?? null,
            bracketDensity: entry.bracketDensity ?? null,
            chordjackScore: entry.chordjackScore ?? null,
            jumpstreamScore: entry.jumpstreamScore ?? null,
            chordstreamScore: entry.chordstreamScore ?? null,
            error: null,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: [
              beatmapPatternAnalysis.beatmapId,
              beatmapPatternAnalysis.algorithm,
            ],
            set: {
              beatmapHash: entry.beatmapHash,
              columnCount: entry.columnCount ?? null,
              dominantPattern: entry.dominantPattern ?? null,
              secondaryPattern: entry.secondaryPattern ?? null,
              shapePattern: entry.shapePattern ?? null,
              secondaryShape: entry.secondaryShape ?? null,
              confidence: entry.confidence ?? null,
              jackDensity: entry.jackDensity ?? null,
              chordDensity: entry.chordDensity ?? null,
              streamDensity: entry.streamDensity ?? null,
              bracketDensity: entry.bracketDensity ?? null,
              chordjackScore: entry.chordjackScore ?? null,
              jumpstreamScore: entry.jumpstreamScore ?? null,
              chordstreamScore: entry.chordstreamScore ?? null,
              error: null,
              updatedAt: now(),
            },
          })
          .run();
        continue;
      }
    }
  });

  stats.applied += writes.length;
}

async function fetchHubCalcBundle(
  version: string,
): Promise<
  | { ok: true; entries: CalcBundleEntry[]; entryCount: number }
  | { ok: false; status: number; message: string }
> {
  if (Date.now() < hubCircuitOpenUntil) {
    return { ok: false, status: 503, message: "Hub circuit open" };
  }
  const hubUrl = resolveHubBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${hubUrl}/calc-bundles/${encodeURIComponent(version)}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (res.status === 404) {
      return { ok: false, status: 404, message: "Calc bundle not found" };
    }
    if (!res.ok) {
      if (res.status >= 500) {
        hubCircuitOpenUntil = Date.now() + HUB_CIRCUIT_COOLDOWN_MS;
      }
      return {
        ok: false,
        status: res.status,
        message: `Hub returned ${res.status}`,
      };
    }
    hubCircuitOpenUntil = 0;
    const data = (await res.json()) as {
      entries?: CalcBundleEntry[];
      entryCount?: number;
    };
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return {
      ok: true,
      entries,
      entryCount: data.entryCount ?? entries.length,
    };
  } catch (err) {
    hubCircuitOpenUntil = Date.now() + HUB_CIRCUIT_COOLDOWN_MS;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull Hub calc bundle for `version`, apply it, mark applied.
 * 404 still marks applied so boot does not retry every start.
 */
export async function pullAndApplyCalcBundle(
  db: Db,
  version: string = APP_VERSION,
  apply?: CalcBundleApplyOptions,
): Promise<CalcBundlePullState> {
  if (pullState.status === "running") {
    return getCalcBundlePullState();
  }

  setPullState({
    status: "running",
    source: "hub",
    version,
    applied: 0,
    skipped: 0,
    unmatched: 0,
    entryCount: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const fetched = await fetchHubCalcBundle(version);
  if (!fetched.ok) {
    if (fetched.status === 404) {
      await setCalcBundleAppliedVersion(db, version);
      setPullState({
        status: "skipped",
        error: null,
        finishedAt: new Date().toISOString(),
      });
      return getCalcBundlePullState();
    }
    setPullState({
      status: "error",
      error: fetched.message,
      finishedAt: new Date().toISOString(),
    });
    // Do not mark applied on transport/server errors — retry next boot.
    return getCalcBundlePullState();
  }

  const stats = await applyCalcBundle(db, fetched.entries, apply);
  await setCalcBundleAppliedVersion(db, version);
  setPullState({
    status: "completed",
    applied: stats.applied,
    skipped: stats.skipped,
    unmatched: stats.unmatched,
    entryCount: fetched.entryCount,
    finishedAt: new Date().toISOString(),
  });
  publish({ type: "dashboard.updated" });
  return getCalcBundlePullState();
}

/**
 * Boot for a packaged install: apply the shipped calc bundle file and mark
 * applied. Packaged boots never call the Hub — the release artifact is the
 * only boot-time gap-fill source, so a missing/unreadable/mismatched file
 * still marks applied (the file cannot self-heal between boots) and leaves
 * previous-version rows in place.
 *
 * With `replaceAlgorithms` set, the successful apply also deletes bundle
 * algorithm rows whose content hash the file does not contain (see
 * `dropCalcBundleLeftovers`) and reports the count as `droppedLeftovers`.
 */
export type CalcBundleBootResult = {
  state: CalcBundlePullState;
  /** Bundle algorithm rows dropped because the shipped file has no entry for their hash (packaged replace path). */
  droppedLeftovers: number;
  /** Pattern rows whose chart shape is not legal for the beatmap's key count; the pattern job refills them. */
  nulledShapes: number;
};

export async function maybeApplyShippedCalcBundleOnBoot(
  db: Db,
  replaceAlgorithms: ReadonlySet<string> | undefined,
): Promise<CalcBundleBootResult> {
  if (pullState.status === "running")
    return {
      state: getCalcBundlePullState(),
      droppedLeftovers: 0,
      nulledShapes: 0,
    };
  const version = APP_VERSION;

  setPullState({
    status: "running",
    source: "file",
    version,
    applied: 0,
    skipped: 0,
    unmatched: 0,
    entryCount: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const filePath = process.env.ROXYSU_CALC_BUNDLE_FILE?.trim() ?? "";
  const read = readShippedCalcBundleFile(
    filePath,
    version,
    CALC_BUNDLE_ALGORITHMS,
  );
  if (!read.ok) {
    console.warn(`[calc-bundle] shipped calc bundle unusable: ${read.reason}`);
    await setCalcBundleAppliedVersion(db, version);
    setPullState({
      status: "skipped",
      error: read.reason,
      finishedAt: new Date().toISOString(),
    });
    return {
      state: getCalcBundlePullState(),
      droppedLeftovers: 0,
      nulledShapes: 0,
    };
  }

  const stats = await applyCalcBundle(db, read.entries, { replaceAlgorithms });
  let droppedLeftovers = 0;
  if (replaceAlgorithms) {
    droppedLeftovers = await dropCalcBundleLeftovers(db, read.entries);
    if (droppedLeftovers > 0) {
      console.log(
        `[calc-bundle] dropped ${droppedLeftovers} stored rows the shipped file does not contain — they will be recomputed by the missing backfill`,
      );
    }
  } else {
    console.log(
      "[calc-bundle] non-packaged boot gap-fill — no stored rows replaced or dropped",
    );
  }
  const nulledShapes = nullIllegalShapeLabels(db);
  if (nulledShapes > 0) {
    console.log(
      `[calc-bundle] nulled ${nulledShapes} chart-shape labels that are not valid for their key count — the pattern job refills them`,
    );
  }
  await setCalcBundleAppliedVersion(db, version);
  setPullState({
    status: "completed",
    applied: stats.applied,
    skipped: stats.skipped,
    unmatched: stats.unmatched,
    entryCount: read.header.entryCount,
    finishedAt: new Date().toISOString(),
  });
  publish({ type: "dashboard.updated" });
  // Consumers of stored dan/pattern rows (open beatmap pages, practice lists)
  // may already be cached; one event keeps them honest.
  publish({ type: "calc-bundle.applied" });
  return {
    state: getCalcBundlePullState(),
    droppedLeftovers,
    nulledShapes,
  };
}

/**
 * Boot: apply shipped file (packaged) or pull the Hub bundle (dev) once per
 * product version. Resolves after the boot apply/pull finished (or failed) —
 * callers may consult `droppedLeftovers` to kick the missing backfill.
 */
export async function maybePullCalcBundleOnBoot(
  db: Db,
): Promise<CalcBundleBootResult | null> {
  try {
    const applied = await getCalcBundleAppliedVersion(db);
    if (applied === APP_VERSION) {
      return {
        state: getCalcBundlePullState(),
        droppedLeftovers: 0,
        nulledShapes: 0,
      };
    }
    const replaceAlgorithms = reworkReplaceAlgorithmsForBoot();
    if (process.env.ROXYSU_PACKAGED === "1") {
      console.log(
        `[calc-bundle] packaged boot: applying shipped calc bundle file for ${APP_VERSION} (was ${applied ?? "none"})${replaceAlgorithms ? "; replacing rework rows" : ""}`,
      );
      const result = await maybeApplyShippedCalcBundleOnBoot(
        db,
        replaceAlgorithms,
      );
      console.log(
        `[calc-bundle] shipped bundle ${result.state.status}: applied=${result.state.applied} skipped=${result.state.skipped} unmatched=${result.state.unmatched}${result.droppedLeftovers ? ` dropped=${result.droppedLeftovers}` : ""}`,
      );
      return result;
    }
    console.log(
      `[calc-bundle] pulling Hub calc bundle for ${APP_VERSION} (was ${applied ?? "none"})${replaceAlgorithms ? "; replacing rework rows" : ""}`,
    );
    const state = await pullAndApplyCalcBundle(db, APP_VERSION, {
      replaceAlgorithms,
    });
    console.log(
      `[calc-bundle] pull ${state.status}: applied=${state.applied} skipped=${state.skipped} unmatched=${state.unmatched}`,
    );
    const nulledShapes = nullIllegalShapeLabels(db);
    return {
      state,
      droppedLeftovers: 0,
      nulledShapes,
    };
  } catch (err) {
    console.error("[calc-bundle] boot pull failed", err);
    return null;
  }
}

/**
 * Chunked admin upload of local export to Hub.
 * The target is always `resolveHubBaseUrl()`; the admin bearer is never sent
 * to a caller-supplied host.
 */
export async function uploadCalcBundleToHub(opts: {
  db: Db;
  token: string;
  roxysuVersion: string;
  label?: string;
}): Promise<{
  entryCount: number;
  chunks: number;
  algorithms: string[];
}> {
  const entries = await exportCalcBundleEntries(opts.db);
  const hubUrl = resolveHubBaseUrl().replace(/\/$/, "");
  let chunks = 0;
  let lastAlgorithms: string[] = [];
  let entryCount = 0;

  if (entries.length === 0) {
    const res = await fetch(`${hubUrl}/admin/calc-bundles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        roxysuVersion: opts.roxysuVersion,
        label: opts.label ?? "",
        replace: true,
        entries: [],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub upload failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      entryCount?: number;
      algorithms?: string[];
    };
    return {
      entryCount: data.entryCount ?? 0,
      chunks: 1,
      algorithms: data.algorithms ?? [],
    };
  }

  for (let i = 0; i < entries.length; i += CALC_BUNDLE_CHUNK_SIZE) {
    const slice = entries.slice(i, i + CALC_BUNDLE_CHUNK_SIZE);
    const replace = i === 0;
    const res = await fetch(`${hubUrl}/admin/calc-bundles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        roxysuVersion: opts.roxysuVersion,
        label: opts.label ?? "",
        replace,
        entries: slice,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hub upload failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as {
      entryCount?: number;
      algorithms?: string[];
    };
    entryCount = data.entryCount ?? entryCount;
    lastAlgorithms = data.algorithms ?? lastAlgorithms;
    chunks++;
  }

  return { entryCount, chunks, algorithms: lastAlgorithms };
}
