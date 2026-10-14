import {
  beatmapDanRatings,
  beatmapPatternAnalysis,
  beatmaps,
  settings,
} from "@roxysu/db/schema";
import { JOBS_CALC_BUNDLE_APPLIED_VERSION_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { resolveHubBaseUrl } from "../hubUrl";
import { APP_VERSION } from "../appVersion";
import { publish } from "../shared/events";
import { SUNNY_ALGORITHM } from "./computeSunnyDan";
import { DANIEL_ALGORITHM } from "./computeDanielDan";
import { REWORK_ALGORITHM } from "./computeReworkDan";
import { PATTERN_ALGORITHM } from "./computePatternAnalysis";

export const CALC_BUNDLE_ALGORITHMS = [
  SUNNY_ALGORITHM,
  DANIEL_ALGORITHM,
  REWORK_ALGORITHM,
  PATTERN_ALGORITHM,
] as const;

export const CALC_BUNDLE_CHUNK_SIZE = 1_500;

const DAN_ALGORITHMS = new Set<string>([
  SUNNY_ALGORITHM,
  DANIEL_ALGORITHM,
  REWORK_ALGORITHM,
]);

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

export type CalcBundlePullState = {
  status: CalcBundlePullStatus;
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

/** Export successful local rows for Hub upload (skip errors / null labels). */
export async function exportCalcBundleEntries(
  db: Db,
): Promise<CalcBundleEntry[]> {
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
        inArray(beatmapDanRatings.algorithm, [
          SUNNY_ALGORITHM,
          DANIEL_ALGORITHM,
          REWORK_ALGORITHM,
        ]),
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

  const out: CalcBundleEntry[] = [];
  for (const row of danRows) {
    if (!row.beatmapHash) continue;
    out.push({
      beatmapHash: row.beatmapHash,
      onlineBeatmapId: row.onlineBeatmapId,
      algorithm: row.algorithm,
      sunnyStar: row.sunnyStar,
      lnRatio: row.lnRatio,
      columnCount: row.columnCount,
      estDiff: row.estDiff,
    });
  }
  for (const row of patternRows) {
    if (!row.beatmapHash) continue;
    out.push({
      beatmapHash: row.beatmapHash,
      onlineBeatmapId: row.onlineBeatmapId,
      algorithm: row.algorithm,
      columnCount: row.columnCount,
      dominantPattern: row.dominantPattern,
      secondaryPattern: row.secondaryPattern,
      confidence: row.confidence,
      jackDensity: row.jackDensity,
      chordDensity: row.chordDensity,
      streamDensity: row.streamDensity,
      bracketDensity: row.bracketDensity,
      chordjackScore: row.chordjackScore,
      jumpstreamScore: row.jumpstreamScore,
      chordstreamScore: row.chordstreamScore,
    });
  }
  return out;
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
 * rows from the Hub bundle on a product-version bump. `bun desktop` does not
 * set `ROXYSU_PACKAGED`, so the dev library is left alone.
 */
export function reworkReplaceAlgorithmsForBoot(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> | undefined {
  if (env.ROXYSU_PACKAGED !== "1") return undefined;
  return new Set([REWORK_ALGORITHM, PATTERN_ALGORITHM]);
}

/**
 * Gap-fill: write Hub entries when the local row is missing or failed.
 * Successful local rows are kept unless `replaceAlgorithms` names that algorithm.
 */
export async function applyCalcBundle(
  db: Db,
  entries: CalcBundleEntry[],
  options?: CalcBundleApplyOptions,
): Promise<ApplyStats> {
  const stats: ApplyStats = { applied: 0, skipped: 0, unmatched: 0 };
  if (entries.length === 0) return stats;

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

  const now = new Date();

  for (const entry of entries) {
    const beatmapId = localByHash.get(entry.beatmapHash);
    if (!beatmapId) {
      stats.unmatched++;
      continue;
    }

    if (DAN_ALGORITHMS.has(entry.algorithm)) {
      const existing = await db
        .select({
          error: beatmapDanRatings.error,
          estDiff: beatmapDanRatings.estDiff,
        })
        .from(beatmapDanRatings)
        .where(
          and(
            eq(beatmapDanRatings.beatmapId, beatmapId),
            eq(beatmapDanRatings.algorithm, entry.algorithm),
          ),
        )
        .get();

      if (
        !options?.replaceAlgorithms?.has(entry.algorithm) &&
        existing &&
        existing.error == null &&
        existing.estDiff != null
      ) {
        stats.skipped++;
        continue;
      }

      await db
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
          updatedAt: now,
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
            updatedAt: now,
          },
        });
      stats.applied++;
      continue;
    }

    if (entry.algorithm === PATTERN_ALGORITHM) {
      const existing = await db
        .select({
          error: beatmapPatternAnalysis.error,
          dominantPattern: beatmapPatternAnalysis.dominantPattern,
        })
        .from(beatmapPatternAnalysis)
        .where(
          and(
            eq(beatmapPatternAnalysis.beatmapId, beatmapId),
            eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
          ),
        )
        .get();

      if (
        !options?.replaceAlgorithms?.has(PATTERN_ALGORITHM) &&
        existing &&
        existing.error == null &&
        existing.dominantPattern != null
      ) {
        stats.skipped++;
        continue;
      }

      await db
        .insert(beatmapPatternAnalysis)
        .values({
          beatmapId,
          algorithm: PATTERN_ALGORITHM,
          beatmapHash: entry.beatmapHash,
          columnCount: entry.columnCount ?? null,
          dominantPattern: entry.dominantPattern ?? null,
          secondaryPattern: entry.secondaryPattern ?? null,
          confidence: entry.confidence ?? null,
          jackDensity: entry.jackDensity ?? null,
          chordDensity: entry.chordDensity ?? null,
          streamDensity: entry.streamDensity ?? null,
          bracketDensity: entry.bracketDensity ?? null,
          chordjackScore: entry.chordjackScore ?? null,
          jumpstreamScore: entry.jumpstreamScore ?? null,
          chordstreamScore: entry.chordstreamScore ?? null,
          error: null,
          updatedAt: now,
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
            confidence: entry.confidence ?? null,
            jackDensity: entry.jackDensity ?? null,
            chordDensity: entry.chordDensity ?? null,
            streamDensity: entry.streamDensity ?? null,
            bracketDensity: entry.bracketDensity ?? null,
            chordjackScore: entry.chordjackScore ?? null,
            jumpstreamScore: entry.jumpstreamScore ?? null,
            chordstreamScore: entry.chordstreamScore ?? null,
            error: null,
            updatedAt: now,
          },
        });
      stats.applied++;
      continue;
    }

    stats.skipped++;
  }

  return stats;
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

/** Boot: pull once per product version when not yet applied. */
export async function maybePullCalcBundleOnBoot(db: Db): Promise<void> {
  try {
    const applied = await getCalcBundleAppliedVersion(db);
    if (applied === APP_VERSION) return;
    const replaceAlgorithms = reworkReplaceAlgorithmsForBoot();
    console.log(
      `[calc-bundle] pulling Hub calc bundle for ${APP_VERSION} (was ${applied ?? "none"})${replaceAlgorithms ? "; replacing rework rows" : ""}`,
    );
    const state = await pullAndApplyCalcBundle(db, APP_VERSION, {
      replaceAlgorithms,
    });
    console.log(
      `[calc-bundle] pull ${state.status}: applied=${state.applied} skipped=${state.skipped} unmatched=${state.unmatched}`,
    );
  } catch (err) {
    console.error("[calc-bundle] boot pull failed", err);
  }
}

/** Chunked admin upload of local export to Hub. */
export async function uploadCalcBundleToHub(opts: {
  db: Db;
  hubUrl: string;
  token: string;
  roxysuVersion: string;
  label?: string;
}): Promise<{
  entryCount: number;
  chunks: number;
  algorithms: string[];
}> {
  const entries = await exportCalcBundleEntries(opts.db);
  const hubUrl = opts.hubUrl.replace(/\/$/, "");
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
