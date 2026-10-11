import { count, desc, eq } from "drizzle-orm";
import {
  CALC_BUNDLE_ALGORITHMS,
  calcBundleEntries,
  calcBundles,
  type CalcBundleAlgorithm,
} from "@roxysu/db/hub";
import { db } from "../db";

export const CALC_BUNDLE_CHUNK_MAX = 2_000;

export type CalcBundleEntryInput = {
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

export type CalcBundleMeta = {
  id: number;
  roxysuVersion: string;
  label: string;
  entryCount: number;
  algorithms: string[];
  uploadedAt: Date | string;
  uploadedByUserId: number | null;
};

const ALLOWED = new Set<string>(CALC_BUNDLE_ALGORITHMS);

export function isCalcBundleAlgorithm(
  value: string,
): value is CalcBundleAlgorithm {
  return ALLOWED.has(value);
}

export function parseAlgorithmsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function serializeBundleMeta(row: {
  id: number;
  roxysuVersion: string;
  label: string;
  entryCount: number;
  algorithms: string;
  uploadedAt: Date | string;
  uploadedByUserId: number | null;
}): CalcBundleMeta {
  return {
    id: row.id,
    roxysuVersion: row.roxysuVersion,
    label: row.label,
    entryCount: row.entryCount,
    algorithms: parseAlgorithmsJson(row.algorithms),
    uploadedAt: row.uploadedAt,
    uploadedByUserId: row.uploadedByUserId,
  };
}

export async function listCalcBundles(): Promise<CalcBundleMeta[]> {
  const rows = await db
    .select()
    .from(calcBundles)
    .orderBy(desc(calcBundles.uploadedAt));
  return rows.map(serializeBundleMeta);
}

export async function getCalcBundleByVersion(version: string) {
  return db
    .select()
    .from(calcBundles)
    .where(eq(calcBundles.roxysuVersion, version))
    .get();
}

function normalizeEntry(input: CalcBundleEntryInput): CalcBundleEntryInput | null {
  const hash = input.beatmapHash?.trim();
  if (!hash || !isCalcBundleAlgorithm(input.algorithm)) return null;
  return {
    beatmapHash: hash,
    onlineBeatmapId: input.onlineBeatmapId ?? null,
    algorithm: input.algorithm,
    sunnyStar: input.sunnyStar ?? null,
    lnRatio: input.lnRatio ?? null,
    columnCount: input.columnCount ?? null,
    estDiff: input.estDiff ?? null,
    dominantPattern: input.dominantPattern ?? null,
    secondaryPattern: input.secondaryPattern ?? null,
    confidence: input.confidence ?? null,
    jackDensity: input.jackDensity ?? null,
    chordDensity: input.chordDensity ?? null,
    streamDensity: input.streamDensity ?? null,
    bracketDensity: input.bracketDensity ?? null,
    chordjackScore: input.chordjackScore ?? null,
    jumpstreamScore: input.jumpstreamScore ?? null,
    chordstreamScore: input.chordstreamScore ?? null,
  };
}

/**
 * Chunked replace/append upload.
 * - replace=true: delete existing bundle for version (if any) and create fresh.
 * - replace=false: append to existing bundle (required for follow-up chunks).
 */
export async function upsertCalcBundleChunk(opts: {
  roxysuVersion: string;
  label?: string;
  replace: boolean;
  entries: CalcBundleEntryInput[];
  uploadedByUserId: number;
}): Promise<{
  id: number;
  roxysuVersion: string;
  entryCount: number;
  appended: number;
  algorithms: string[];
}> {
  const version = opts.roxysuVersion.trim();
  if (!version) throw new Error("roxysuVersion is required");

  const normalized = opts.entries
    .map(normalizeEntry)
    .filter((e): e is CalcBundleEntryInput => e != null);

  let bundle = await getCalcBundleByVersion(version);

  if (opts.replace) {
    if (bundle) {
      await db.delete(calcBundles).where(eq(calcBundles.id, bundle.id));
      bundle = undefined;
    }
    const algorithms = [
      ...new Set(normalized.map((e) => e.algorithm)),
    ].sort();
    bundle = await db
      .insert(calcBundles)
      .values({
        roxysuVersion: version,
        label: opts.label ?? "",
        entryCount: 0,
        algorithms: JSON.stringify(algorithms),
        uploadedByUserId: opts.uploadedByUserId,
        uploadedAt: new Date(),
      })
      .returning()
      .get();
  } else if (!bundle) {
    throw new Error("Bundle not found — send replace=true on the first chunk");
  } else if (opts.label !== undefined) {
    await db
      .update(calcBundles)
      .set({ label: opts.label })
      .where(eq(calcBundles.id, bundle.id));
  }

  if (!bundle) throw new Error("Failed to create calc bundle");

  if (normalized.length > 0) {
    // Insert in smaller SQLite batches; ignore exact duplicates within chunk.
    const BATCH = 200;
    for (let i = 0; i < normalized.length; i += BATCH) {
      const slice = normalized.slice(i, i + BATCH);
      await db
        .insert(calcBundleEntries)
        .values(
          slice.map((e) => ({
            bundleId: bundle!.id,
            beatmapHash: e.beatmapHash,
            onlineBeatmapId: e.onlineBeatmapId ?? null,
            algorithm: e.algorithm,
            sunnyStar: e.sunnyStar ?? null,
            lnRatio: e.lnRatio ?? null,
            columnCount: e.columnCount ?? null,
            estDiff: e.estDiff ?? null,
            dominantPattern: e.dominantPattern ?? null,
            secondaryPattern: e.secondaryPattern ?? null,
            confidence: e.confidence ?? null,
            jackDensity: e.jackDensity ?? null,
            chordDensity: e.chordDensity ?? null,
            streamDensity: e.streamDensity ?? null,
            bracketDensity: e.bracketDensity ?? null,
            chordjackScore: e.chordjackScore ?? null,
            jumpstreamScore: e.jumpstreamScore ?? null,
            chordstreamScore: e.chordstreamScore ?? null,
          })),
        )
        .onConflictDoNothing();
    }
  }

  const algoRows = await db
    .selectDistinct({ algorithm: calcBundleEntries.algorithm })
    .from(calcBundleEntries)
    .where(eq(calcBundleEntries.bundleId, bundle.id));
  const algorithms = algoRows.map((r) => r.algorithm).sort();

  const [{ n }] = await db
    .select({ n: count() })
    .from(calcBundleEntries)
    .where(eq(calcBundleEntries.bundleId, bundle.id));

  await db
    .update(calcBundles)
    .set({
      entryCount: n,
      algorithms: JSON.stringify(algorithms),
      uploadedAt: new Date(),
      uploadedByUserId: opts.uploadedByUserId,
    })
    .where(eq(calcBundles.id, bundle.id));

  return {
    id: bundle.id,
    roxysuVersion: version,
    entryCount: n,
    appended: normalized.length,
    algorithms,
  };
}

export async function deleteCalcBundleByVersion(
  version: string,
): Promise<boolean> {
  const row = await getCalcBundleByVersion(version);
  if (!row) return false;
  await db.delete(calcBundles).where(eq(calcBundles.id, row.id));
  return true;
}

export async function listCalcBundleEntries(bundleId: number) {
  return db
    .select()
    .from(calcBundleEntries)
    .where(eq(calcBundleEntries.bundleId, bundleId));
}

export function serializeEntry(row: typeof calcBundleEntries.$inferSelect) {
  return {
    beatmapHash: row.beatmapHash,
    onlineBeatmapId: row.onlineBeatmapId,
    algorithm: row.algorithm,
    sunnyStar: row.sunnyStar,
    lnRatio: row.lnRatio,
    columnCount: row.columnCount,
    estDiff: row.estDiff,
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
  };
}
