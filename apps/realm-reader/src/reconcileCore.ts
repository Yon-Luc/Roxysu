/**
 * Reconcile logic that does not need the Realm native addon: the catch-up
 * stall breaker, orphan deletion, and the row-count gap round. Realm access is
 * injected so the rules are testable under Bun.
 */
import {
  beatmapSets,
  beatmaps,
  beatmapDanRatings,
  beatmapDanRatingVariants,
  beatmapManiaRatings,
  beatmapPatternAnalysis,
  playSessions,
  mastery,
  notes,
  beatmapTags,
  scoreMetrics,
  scores,
  settings,
  eq,
  inArray,
  count,
  type Db,
} from "@roxysu/db/client.node";
import { SYNC_CATCHUP_STALLED_KEY } from "@roxysu/db/settings-keys";
import { BATCH_SIZE, chunk, withBusyRetry } from "./upsert";

/** Reconcile catch-up stops retrying after this many fruitless rounds. */
export const CATCHUP_STALL_LIMIT = 3;

export function readStallCount(db: Db): number {
  const raw = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_CATCHUP_STALLED_KEY))
    .get()?.value;
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function writeStallCount(db: Db, n: number) {
  withBusyRetry(() =>
    db
      .insert(settings)
      .values({ key: SYNC_CATCHUP_STALLED_KEY, value: String(n) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: String(n) },
      })
      .run(),
  );
}

/** New rows landed → give reconcile catch-up another chance. */
export function clearCatchupStallIfSet(db: Db) {
  if (readStallCount(db) > 0) writeStallCount(db, 0);
}

function deleteByIds(
  db: Db,
  table:
    | typeof scores
    | typeof beatmaps
    | typeof beatmapSets
    | typeof scoreMetrics
    | typeof mastery
    | typeof notes
    | typeof beatmapTags
    | typeof beatmapDanRatings
    | typeof beatmapDanRatingVariants
    | typeof beatmapManiaRatings
    | typeof beatmapPatternAnalysis
    | typeof playSessions,
  idColumn: { name: string },
  ids: string[],
) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (const batch of chunk(ids, BATCH_SIZE)) {
    const result = withBusyRetry(() =>
      db
        .delete(table)
        .where(inArray(idColumn as never, batch))
        .run(),
    );
    deleted += result.changes;
  }
  return deleted;
}

export type RealmIdSets = {
  realmScoreIds: Set<string>;
  realmBeatmapIds: Set<string>;
  realmSetIds: Set<string>;
};

export type DeleteResult = {
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  deletedScoreIds: string[];
  deletedBeatmapIds: string[];
};

export const NO_DELETES: DeleteResult = {
  scoresDeleted: 0,
  beatmapsDeleted: 0,
  beatmapSetsDeleted: 0,
  deletedScoreIds: [],
  deletedBeatmapIds: [],
};

/** Remove SQLite rows that no longer exist in Realm (full/reconcile only). */
export function reconcileDeletes(
  db: Db,
  realmScoreIds: Set<string>,
  realmBeatmapIds: Set<string>,
  realmSetIds: Set<string>,
): DeleteResult {
  const sqliteScoreIds = db
    .select({ id: scores.id })
    .from(scores)
    .all()
    .map((r) => r.id);
  const orphanScores = sqliteScoreIds.filter((id) => !realmScoreIds.has(id));

  if (orphanScores.length > 0) {
    deleteByIds(db, scoreMetrics, scoreMetrics.scoreId as never, orphanScores);
    deleteByIds(db, scores, scores.id as never, orphanScores);
  }

  const sqliteBeatmapIds = db
    .select({ id: beatmaps.id })
    .from(beatmaps)
    .all()
    .map((r) => r.id);
  const orphanBeatmaps = sqliteBeatmapIds.filter(
    (id) => !realmBeatmapIds.has(id),
  );

  if (orphanBeatmaps.length > 0) {
    for (const batch of chunk(orphanBeatmaps, BATCH_SIZE)) {
      withBusyRetry(() =>
        db
          .update(scores)
          .set({ beatmapId: null })
          .where(inArray(scores.beatmapId, batch))
          .run(),
      );
    }
    deleteByIds(db, mastery, mastery.beatmapId as never, orphanBeatmaps);
    deleteByIds(db, notes, notes.beatmapId as never, orphanBeatmaps);
    deleteByIds(
      db,
      beatmapTags,
      beatmapTags.beatmapId as never,
      orphanBeatmaps,
    );
    deleteByIds(
      db,
      beatmapDanRatings,
      beatmapDanRatings.beatmapId as never,
      orphanBeatmaps,
    );
    deleteByIds(
      db,
      beatmapDanRatingVariants,
      beatmapDanRatingVariants.beatmapId as never,
      orphanBeatmaps,
    );
    deleteByIds(
      db,
      beatmapManiaRatings,
      beatmapManiaRatings.beatmapId as never,
      orphanBeatmaps,
    );
    deleteByIds(
      db,
      beatmapPatternAnalysis,
      beatmapPatternAnalysis.beatmapId as never,
      orphanBeatmaps,
    );
    // Roxysu Play results reference the beatmap row; with foreign keys on, the
    // beatmap cannot be deleted while they exist.
    deleteByIds(
      db,
      playSessions,
      playSessions.beatmapId as never,
      orphanBeatmaps,
    );
    deleteByIds(db, beatmaps, beatmaps.id as never, orphanBeatmaps);
  }

  const sqliteSetIds = db
    .select({ id: beatmapSets.id })
    .from(beatmapSets)
    .all()
    .map((r) => r.id);
  // Foreign keys are enforced: a set still referenced by a surviving beatmap
  // row stays until that beatmap is reconciled away.
  const referencedSetIds = new Set(
    db
      .select({ id: beatmaps.setId })
      .from(beatmaps)
      .groupBy(beatmaps.setId)
      .all()
      .map((r) => r.id),
  );
  const orphanSets = sqliteSetIds.filter(
    (id) => !realmSetIds.has(id) && !referencedSetIds.has(id),
  );
  if (orphanSets.length > 0) {
    deleteByIds(db, beatmapSets, beatmapSets.id as never, orphanSets);
  }

  return {
    scoresDeleted: orphanScores.length,
    beatmapsDeleted: orphanBeatmaps.length,
    beatmapSetsDeleted: orphanSets.length,
    deletedScoreIds: orphanScores,
    deletedBeatmapIds: orphanBeatmaps,
  };
}

export type RealmCounts = {
  scores: number;
  beatmaps: number;
  sets: number;
};

export type CatchUpResult = {
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rulesetsUpserted: number;
  changedBeatmapIds: string[];
  changedScoreIds: string[];
  rowsChanged: number;
};

export const NO_CATCH_UP: CatchUpResult = {
  beatmapSetsUpserted: 0,
  beatmapsUpserted: 0,
  scoresUpserted: 0,
  rulesetsUpserted: 0,
  changedBeatmapIds: [],
  changedScoreIds: [],
  rowsChanged: 0,
};

function sqliteCounts(db: Db): RealmCounts {
  return {
    scores: db.select({ n: count() }).from(scores).get()?.n ?? 0,
    beatmaps: db.select({ n: count() }).from(beatmaps).get()?.n ?? 0,
    sets: db.select({ n: count() }).from(beatmapSets).get()?.n ?? 0,
  };
}

function countsEqual(a: RealmCounts, b: RealmCounts): boolean {
  return a.scores === b.scores && a.beatmaps === b.beatmaps && a.sets === b.sets;
}

/** State carried from the streaming phase of a count-gap round into its commit phase. */
export type CountGapRound = {
  /** Realm id sets; null when row counts already matched (nothing to do). */
  ids: RealmIdSets | null;
  /** Catch-up was skipped because the stall breaker had already tripped. */
  stalled: boolean;
  stallCount: number;
  caughtUp: CatchUpResult;
};

/**
 * Streaming phase (autocommit): when Realm and SQLite row counts differ,
 * collect the Realm id sets and, unless the stall breaker has tripped, catch
 * up the Realm rows missing from SQLite.
 *
 * A tripped stall breaker skips ONLY the catch-up. The id sets are still
 * collected so the commit phase can delete orphans: unmirrorable Realm rows
 * (which stall the gap) and real SQLite orphans can coexist.
 */
export function startCountGapRound(
  db: Db,
  realmCounts: RealmCounts,
  deps: {
    collectRealmIdSets: () => RealmIdSets;
    catchUp: (ids: RealmIdSets) => CatchUpResult;
  },
): CountGapRound {
  if (countsEqual(sqliteCounts(db), realmCounts)) {
    return { ids: null, stalled: false, stallCount: 0, caughtUp: NO_CATCH_UP };
  }

  const stallCount = readStallCount(db);
  const stalled = stallCount >= CATCHUP_STALL_LIMIT;
  const ids = deps.collectRealmIdSets();
  if (stalled) {
    console.log(
      `reconcile: skipping catch-up — row-count gap survived ${stallCount} fruitless rounds (unmirrorable Realm rows?); still deleting orphans. Cleared automatically once new rows import.`,
    );
    return { ids, stalled, stallCount, caughtUp: NO_CATCH_UP };
  }
  return { ids, stalled, stallCount, caughtUp: deps.catchUp(ids) };
}

/**
 * Commit phase (call inside the import's commit transaction): delete orphans
 * and record the stall counter.
 *
 * A round is fruitless only when the missing-id catch-up moved zero rows:
 * deleting orphans never re-arms the breaker. A stalled round leaves the
 * counter alone. The counter resets when the gap closes.
 */
export function finishCountGapRound(
  tx: Db,
  round: CountGapRound,
  realmCounts: RealmCounts,
): DeleteResult {
  if (!round.ids) return NO_DELETES;

  const deleted = reconcileDeletes(
    tx,
    round.ids.realmScoreIds,
    round.ids.realmBeatmapIds,
    round.ids.realmSetIds,
  );

  if (countsEqual(sqliteCounts(tx), realmCounts)) {
    writeStallCount(tx, 0);
  } else if (!round.stalled) {
    writeStallCount(
      tx,
      round.caughtUp.rowsChanged > 0 ? 0 : round.stallCount + 1,
    );
  }
  return deleted;
}
