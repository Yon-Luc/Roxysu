/**
 * Import journal + commit phase for Realm extraction.
 *
 * Kept free of the Realm native addon so the journal rules can be tested under
 * Bun. A cycle claims a `running` import, streams batches into the local
 * mirror with autocommit (short write locks), and only flips the import to
 * `success` inside one short immediate transaction (`commitImport`). Readers
 * trust the mirror only through the latest `success` import, so an
 * interrupted cycle never looks complete.
 */
import {
  beatmaps,
  imports,
  scores,
  and,
  desc,
  eq,
  max,
  sql,
  type Db,
} from "@roxysu/db/client.node";
import { withBusyRetry } from "./upsert";

export type SyncKind = "full" | "incremental" | "reconcile";

export class RealmLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealmLockedError";
  }
}

/** Above this many changed IDs, analytics should full-rebuild (null delta payload). */
export const FULL_ANALYTICS_ID_THRESHOLD = 5_000;

/** Retain recent import journal rows; drop older history to bound WAL growth. */
const IMPORTS_RETAIN = 500;

export type ExtractionWatermarks = {
  maxPlayedAt: Date | null;
  maxLastLocalUpdate: Date | null;
};

export function playedAtMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return Number.isFinite(value) ? value : null;
}

export function laterDate(
  current: Date | null,
  value: Date | number | null | undefined,
): Date | null {
  const ms = playedAtMs(value);
  if (ms == null) return current;
  if (current == null || ms > current.getTime()) return new Date(ms);
  return current;
}

export function advanceWatermarks(
  previous: ExtractionWatermarks,
  scoreRows: ReadonlyArray<{ playedAt?: Date | number | null }>,
  beatmapRows: ReadonlyArray<{ lastLocalUpdate?: Date | number | null }>,
): ExtractionWatermarks {
  let maxPlayedAt = previous.maxPlayedAt;
  let maxLastLocalUpdate = previous.maxLastLocalUpdate;
  for (const row of scoreRows) maxPlayedAt = laterDate(maxPlayedAt, row.playedAt);
  for (const row of beatmapRows) {
    maxLastLocalUpdate = laterDate(maxLastLocalUpdate, row.lastLocalUpdate);
  }
  return { maxPlayedAt, maxLastLocalUpdate };
}

/** Rows that survived constraint bisect (skippedKeys are `id=…` from upsert). */
export function withoutSkipped<T extends { id: string }>(
  rows: readonly T[],
  skippedKeys: readonly string[],
): T[] {
  if (skippedKeys.length === 0) return [...rows];
  const skipped = new Set(skippedKeys);
  return rows.filter((row) => !skipped.has(`id=${row.id}`));
}

export function hasSuccessfulImport(db: Db): boolean {
  const row = db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.status, "success"))
    .orderBy(desc(imports.id))
    .limit(1)
    .get();
  return row != null;
}

function fallbackWatermarksFromTables(db: Db): ExtractionWatermarks {
  const [scoreRow] = db
    .select({ maxPlayed: max(scores.playedAt) })
    .from(scores)
    .all();
  const [beatmapRow] = db
    .select({ maxUpdate: max(beatmaps.lastLocalUpdate) })
    .from(beatmaps)
    .all();

  const playedMs = playedAtMs(scoreRow?.maxPlayed);
  const updateMs = playedAtMs(beatmapRow?.maxUpdate);

  return {
    maxPlayedAt: playedMs != null ? new Date(playedMs) : null,
    maxLastLocalUpdate: updateMs != null ? new Date(updateMs) : null,
  };
}

/**
 * Incremental cursor: the last `success` import's watermarks.
 *
 * With no `success` import at all (first run, or a bootstrap that was killed
 * before it committed) the mirror may be half-extracted. Deriving a cursor
 * from `MAX()` over the data tables would make an incremental cycle skip every
 * older Realm row forever and then record `success`, so no cursor is returned
 * and the caller must run a full extraction.
 */
export function getWatermarks(db: Db): ExtractionWatermarks {
  const lastSuccess = db
    .select({
      watermarkPlayedAt: imports.watermarkPlayedAt,
      watermarkLastLocalUpdate: imports.watermarkLastLocalUpdate,
    })
    .from(imports)
    .where(eq(imports.status, "success"))
    .orderBy(desc(imports.id))
    .limit(1)
    .get();

  if (!lastSuccess) return { maxPlayedAt: null, maxLastLocalUpdate: null };

  if (
    lastSuccess.watermarkPlayedAt != null ||
    lastSuccess.watermarkLastLocalUpdate != null
  ) {
    const playedMs = playedAtMs(lastSuccess.watermarkPlayedAt);
    const updateMs = playedAtMs(lastSuccess.watermarkLastLocalUpdate);
    return {
      maxPlayedAt: playedMs != null ? new Date(playedMs) : null,
      maxLastLocalUpdate: updateMs != null ? new Date(updateMs) : null,
    };
  }

  // A committed import that recorded no watermark (e.g. an empty Realm).
  return fallbackWatermarksFromTables(db);
}

export function withTransaction<T>(
  db: Db,
  fn: (tx: Db) => T,
  behavior: "deferred" | "immediate" = "deferred",
): T {
  return withBusyRetry(() =>
    db.transaction((tx) => fn(tx as unknown as Db), { behavior }),
  );
}

function encodeChangedIds(ids: string[] | null): string | null {
  if (ids == null) return null;
  if (ids.length > FULL_ANALYTICS_ID_THRESHOLD) return null;
  return JSON.stringify(ids);
}

function pruneImports(db: Db) {
  // Use Drizzle `run(sql)` so this works on both the root db and a
  // transaction (`tx` has no `$client`).
  withBusyRetry(() => {
    db.run(sql`
      DELETE FROM imports
      WHERE id NOT IN (
        SELECT id FROM imports ORDER BY id DESC LIMIT ${IMPORTS_RETAIN}
      )
    `);
  });
}

export type ImportCounts = {
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rowsChanged: number;
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  changedScoreIds: string[] | null;
  changedBeatmapIds: string[] | null;
};

export function finishImport(
  db: Db,
  importId: number,
  counts: ImportCounts,
  watermarks: ExtractionWatermarks,
) {
  withBusyRetry(() =>
    db
      .update(imports)
      .set({
        status: "success",
        finishedAt: new Date(),
        progressAt: new Date(),
        beatmapSetsUpserted: counts.beatmapSetsUpserted,
        beatmapsUpserted: counts.beatmapsUpserted,
        scoresUpserted: counts.scoresUpserted,
        rowsChanged: counts.rowsChanged,
        scoresDeleted: counts.scoresDeleted,
        beatmapsDeleted: counts.beatmapsDeleted,
        beatmapSetsDeleted: counts.beatmapSetsDeleted,
        changedScoreIds: encodeChangedIds(counts.changedScoreIds),
        changedBeatmapIds: encodeChangedIds(counts.changedBeatmapIds),
        watermarkPlayedAt: watermarks.maxPlayedAt,
        watermarkLastLocalUpdate: watermarks.maxLastLocalUpdate,
      })
      .where(and(eq(imports.id, importId), eq(imports.status, "running")))
      .run(),
  );
  pruneImports(db);
}

/**
 * The commit phase of a cycle: everything that must land together with the
 * `success` flip (orphan deletes, stall counter, one-shot flags, watermarks)
 * runs in ONE immediate transaction. Streaming batches before this point
 * commit on their own, so the write lock is only held for this short phase.
 * If `work` throws, the transaction rolls back and the import stays `running`
 * (the caller marks it failed), so a half-applied commit is impossible.
 */
export function commitImport<T>(
  db: Db,
  importId: number,
  work: (tx: Db) => {
    counts: ImportCounts;
    watermarks: ExtractionWatermarks;
    result: T;
  },
): T {
  return withTransaction(
    db,
    (tx) => {
      const { counts, watermarks, result } = work(tx);
      finishImport(tx, importId, counts, watermarks);
      return result;
    },
    "immediate",
  );
}

export function failImport(db: Db, importId: number, err: unknown) {
  const status = err instanceof RealmLockedError ? "locked" : "failed";
  withBusyRetry(() =>
    db
      .update(imports)
      .set({
        status,
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(and(eq(imports.id, importId), eq(imports.status, "running")))
      .run(),
  );
}

export function claimImport(db: Db, kind: SyncKind) {
  return withBusyRetry(() =>
    db
      .insert(imports)
      .values({
        kind,
        status: "running",
        startedAt: new Date(),
        progressAt: new Date(),
        realmSchemaVersion: 0,
      })
      .returning({ id: imports.id })
      .get(),
  );
}

/** Heartbeat. Stale is "no progress", not "started a long time ago". */
export function touchImportProgress(db: Db, importId: number, now = Date.now()) {
  withBusyRetry(() =>
    db
      .update(imports)
      .set({ progressAt: new Date(now) })
      .where(and(eq(imports.id, importId), eq(imports.status, "running")))
      .run(),
  );
}

const IMPORT_PROGRESS_TOUCH_MS = 30_000;

/** Throttled touch for streamed batches. The first call always writes. */
export function createImportProgressTouch(db: Db, importId: number) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (last !== 0 && now - last < IMPORT_PROGRESS_TOUCH_MS) return;
    last = now;
    touchImportProgress(db, importId, now);
  };
}

export function setImportSchemaVersion(db: Db, importId: number, version: number) {
  withBusyRetry(() =>
    db
      .update(imports)
      .set({ realmSchemaVersion: version })
      .where(eq(imports.id, importId))
      .run(),
  );
}
