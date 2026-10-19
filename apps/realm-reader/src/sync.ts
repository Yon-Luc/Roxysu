import {
  beatmapSets,
  beatmaps,
  rulesets,
  scores,
  settings,
  eq,
  type Db,
} from "@roxysu/db/client.node";
import path from "node:path";
import Realm from "realm";
import {
  mapBeatmap,
  mapBeatmapSet,
  mapRuleset,
  mapScore,
  type BeatmapRow,
  type BeatmapSetRow,
  type RulesetRow,
  type ScoreRow,
} from "./map";
import { loadOsuSchema } from "./schema";
import { platformDefaultOsuDataPath } from "./osu-paths";
import { syncRealmCollectionsFromRealm } from "./syncRealmCollections";
import { syncRealmSkinsFromRealm } from "./syncRealmSkins";
import { streamMappedUpsert, upsertBatches, withBusyRetry } from "./upsert";
import { SYNC_SCHEMA_OUTDATED_KEY } from "@roxysu/db/settings-keys";
import {
  SchemaVersionMismatchError,
  toSchemaVersionMismatchError,
} from "./schemaMismatch";
import {
  RealmLockedError,
  claimImport,
  commitImport,
  createImportProgressTouch,
  failImport,
  getWatermarks,
  hasSuccessfulImport,
  laterDate,
  setImportSchemaVersion,
  type SyncKind,
} from "./importJournal";
import {
  clearCatchupStallIfSet,
  finishCountGapRound,
  reconcileDeletes,
  startCountGapRound,
  type RealmCounts,
} from "./reconcileCore";
import {
  DeltaWriter,
  healFlaggedRows,
  streamIncrementalDelta,
  type ExtractionSource,
  type FlagKind,
} from "./deltaCore";

export { SchemaVersionMismatchError, toSchemaVersionMismatchError };
export { RealmLockedError, hasSuccessfulImport };
export type { SyncKind };

export { defaultDbPath } from "@roxysu/db/path";

/** One-shot flag: remapped scores after replay_file_hash column was added. */
const REPLAY_HASH_BACKFILL_KEY = "sync.replay_hash_backfill_v1";

/** Realm uuid PKs require a BSON.UUID instance, not a plain string. */
function realmUuid(id: string): Realm.BSON.UUID {
  return new Realm.BSON.UUID(id);
}

function isLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("lock") ||
    lower.includes("already opened") ||
    lower.includes("already in use") ||
    lower.includes("resource busy") ||
    lower.includes("ebusy") ||
    lower.includes("eacces") ||
    lower.includes("permission denied")
  );
}

/** Realm file is newer than this build. The client app reads this row for the notice. */
export function recordSchemaOutdated(db: Db, err: SchemaVersionMismatchError) {
  const value = JSON.stringify({ expected: err.expected, actual: err.actual });
  withBusyRetry(() =>
    db
      .insert(settings)
      .values({ key: SYNC_SCHEMA_OUTDATED_KEY, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      })
      .run(),
  );
}

/** A Realm open succeeded, so this build matches the file schema again. */
export function clearSchemaOutdated(db: Db) {
  const existing = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_SCHEMA_OUTDATED_KEY))
    .get();
  if (!existing) return;
  withBusyRetry(() =>
    db.delete(settings).where(eq(settings.key, SYNC_SCHEMA_OUTDATED_KEY)).run(),
  );
}

export type SyncResult = {
  kind: SyncKind;
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rulesetsUpserted: number;
  rowsChanged: number;
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  realmSchemaVersion: number;
};

function openRealm(realmPath: string, db: Db): Realm {
  const { schemaVersion, schema } = loadOsuSchema();
  try {
    const realm = new Realm({
      path: realmPath,
      schema,
      schemaVersion,
      readOnly: true,
    });
    // Constructor enforces version equality, so a successful open means this
    // build matches. Clear before the rest of the cycle so the notice drops
    // immediately instead of waiting out a long import.
    clearSchemaOutdated(db);
    return realm;
  } catch (err) {
    const mismatch = toSchemaVersionMismatchError(err);
    if (mismatch) throw mismatch;
    if (isLockError(err)) {
      throw new RealmLockedError(
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

function assertSchemaVersion(realm: Realm) {
  const expected = loadOsuSchema().schemaVersion;
  const actual = realm.schemaVersion;
  if (actual !== expected) {
    throw new SchemaVersionMismatchError(expected, actual);
  }
  return actual;
}

function trySyncRealmCollections(
  db: Db,
  realm: Realm,
  rewriteUnchanged: boolean,
) {
  try {
    syncRealmCollectionsFromRealm(db, realm, { rewriteUnchanged });
  } catch (err) {
    console.error("realm collection extract failed:", err);
  }
}

function trySyncRealmSkins(db: Db, realm: Realm) {
  try {
    syncRealmSkinsFromRealm(db, realm);
  } catch (err) {
    console.error("realm skin extract failed:", err);
  }
}
/** Collect primary keys only — used by periodic reconcile / missing catch-up. */
function collectRealmIdSets(realm: Realm): {
  realmScoreIds: Set<string>;
  realmBeatmapIds: Set<string>;
  realmSetIds: Set<string>;
} {
  const realmSetIds = new Set<string>();
  for (const obj of realm.objects("BeatmapSet")) {
    const id = (obj as { ID?: unknown }).ID;
    if (id != null) realmSetIds.add(String(id));
  }

  const realmBeatmapIds = new Set<string>();
  for (const obj of realm.objects("Beatmap")) {
    const id = (obj as { ID?: unknown }).ID;
    if (id != null) realmBeatmapIds.add(String(id));
  }

  const realmScoreIds = new Set<string>();
  for (const obj of realm.objects("Score")) {
    const id = (obj as { ID?: unknown }).ID;
    if (id != null) realmScoreIds.add(String(id));
  }

  return { realmScoreIds, realmBeatmapIds, realmSetIds };
}

function sqliteIdSet(
  db: Db,
  table: typeof beatmaps | typeof beatmapSets | typeof scores,
): Set<string> {
  return new Set(
    db
      .select({ id: table.id })
      .from(table)
      .all()
      .map((r) => r.id),
  );
}

function idsMissingFromSqlite(
  realmIds: Set<string>,
  sqliteIds: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const id of realmIds) {
    if (!sqliteIds.has(id)) missing.push(id);
  }
  return missing;
}

/**
 * Upsert Realm objects whose IDs are absent from SQLite.
 * Heals maps/scores missed by watermark incremental (e.g. null LastLocalUpdate).
 */
function catchUpMissingFromRealm(
  db: Db,
  realm: Realm,
  realmIds: {
    realmScoreIds: Set<string>;
    realmBeatmapIds: Set<string>;
    realmSetIds: Set<string>;
  },
  onBatch?: () => void,
): {
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rulesetsUpserted: number;
  changedBeatmapIds: string[];
  changedScoreIds: string[];
  rowsChanged: number;
} {
  const sqliteSetIds = sqliteIdSet(db, beatmapSets);
  const sqliteBeatmapIds = sqliteIdSet(db, beatmaps);
  const sqliteScoreIds = sqliteIdSet(db, scores);

  const missingSetIds = idsMissingFromSqlite(
    realmIds.realmSetIds,
    sqliteSetIds,
  );
  const missingBeatmapIds = idsMissingFromSqlite(
    realmIds.realmBeatmapIds,
    sqliteBeatmapIds,
  );
  const missingScoreIds = idsMissingFromSqlite(
    realmIds.realmScoreIds,
    sqliteScoreIds,
  );

  if (
    missingSetIds.length === 0 &&
    missingBeatmapIds.length === 0 &&
    missingScoreIds.length === 0
  ) {
    return {
      beatmapSetsUpserted: 0,
      beatmapsUpserted: 0,
      scoresUpserted: 0,
      rulesetsUpserted: 0,
      changedBeatmapIds: [],
      changedScoreIds: [],
      rowsChanged: 0,
    };
  }

  const setRows: BeatmapSetRow[] = [];
  const setIdsQueued = new Set<string>();
  const queueSet = (setId: string) => {
    if (sqliteSetIds.has(setId) || setIdsQueued.has(setId)) return;
    const obj = realm.objectForPrimaryKey("BeatmapSet", realmUuid(setId));
    if (!obj) return;
    const row = mapBeatmapSet(obj as never);
    if (!row) return;
    setRows.push(row);
    setIdsQueued.add(setId);
  };

  for (const id of missingSetIds) queueSet(id);

  const beatmapRows: BeatmapRow[] = [];
  const rulesetShortNames = new Set<string>();
  for (const id of missingBeatmapIds) {
    const obj = realm.objectForPrimaryKey("Beatmap", realmUuid(id));
    if (!obj) continue;
    const row = mapBeatmap(obj as never);
    if (!row) continue;
    beatmapRows.push(row);
    queueSet(row.setId);
    if (row.rulesetShortName) rulesetShortNames.add(row.rulesetShortName);
  }

  const scoreRows: ScoreRow[] = [];
  const knownBeatmapIds = new Set([
    ...sqliteBeatmapIds,
    ...beatmapRows.map((r) => r.id),
  ]);
  for (const id of missingScoreIds) {
    const obj = realm.objectForPrimaryKey("Score", realmUuid(id));
    if (!obj) continue;
    const row = mapScore(obj as never);
    if (!row) continue;
    if (row.beatmapId && !knownBeatmapIds.has(row.beatmapId)) {
      const bm = realm.objectForPrimaryKey("Beatmap", realmUuid(row.beatmapId));
      const mapped = bm ? mapBeatmap(bm as never) : null;
      if (mapped) {
        beatmapRows.push(mapped);
        knownBeatmapIds.add(mapped.id);
        queueSet(mapped.setId);
        if (mapped.rulesetShortName) {
          rulesetShortNames.add(mapped.rulesetShortName);
        }
      } else {
        row.beatmapId = null;
      }
    }
    if (row.rulesetShortName) rulesetShortNames.add(row.rulesetShortName);
    scoreRows.push(row);
  }

  const rulesetRows: RulesetRow[] = [];
  for (const shortName of rulesetShortNames) {
    const matches = realm
      .objects("Ruleset")
      .filtered("ShortName == $0", shortName);
    for (const obj of matches) {
      const row = mapRuleset(obj as never);
      if (row) rulesetRows.push(row);
    }
  }

  const rulesetsUpserted = upsertBatches(
    db,
    rulesets,
    rulesetRows as Record<string, unknown>[],
    ["shortName"],
    onBatch,
  );
  const beatmapSetsUpserted = upsertBatches(
    db,
    beatmapSets,
    setRows as Record<string, unknown>[],
    ["id"],
    onBatch,
  );
  const beatmapsUpserted = upsertBatches(
    db,
    beatmaps,
    beatmapRows as Record<string, unknown>[],
    ["id"],
    onBatch,
  );
  const scoresUpserted = upsertBatches(
    db,
    scores,
    scoreRows as Record<string, unknown>[],
    ["id"],
    onBatch,
  );

  return {
    beatmapSetsUpserted: beatmapSetsUpserted.attempted,
    beatmapsUpserted: beatmapsUpserted.attempted,
    scoresUpserted: scoresUpserted.attempted,
    rulesetsUpserted: rulesetsUpserted.attempted,
    changedBeatmapIds: beatmapRows.map((r) => r.id),
    changedScoreIds: scoreRows.map((r) => r.id),
    rowsChanged:
      rulesetsUpserted.changed +
      beatmapSetsUpserted.changed +
      beatmapsUpserted.changed +
      scoresUpserted.changed,
  };
}

/** Read-only view of an open Realm for `deltaCore` (kept thin: no logic here). */
function realmSource(realm: Realm): ExtractionSource {
  const flagFilter: Record<FlagKind, [string, string]> = {
    softScore: ["Score", "DeletePending == true"],
    softSet: ["BeatmapSet", "DeletePending == true"],
    hiddenBeatmap: ["Beatmap", "Hidden == true"],
  };
  return {
    beatmapsUpdatedAfter: (since) =>
      realm.objects("Beatmap").filtered("LastLocalUpdate > $0", since),
    scoresPlayedAfter: (since) =>
      realm.objects("Score").filtered("Date > $0", since),
    *flaggedIds(kind) {
      const [cls, filter] = flagFilter[kind];
      for (const obj of realm.objects(cls).filtered(filter)) {
        const id = (obj as { ID?: unknown }).ID;
        if (id != null) yield String(id);
      }
    },
    objectById: (cls, id) =>
      realm.objectForPrimaryKey(cls, realmUuid(id) as never),
    rulesetsByShortName: (shortName) =>
      realm.objects("Ruleset").filtered("ShortName == $0", shortName),
  };
}


/**
 * Bootstrap / forced full: remap + upsert everything, then reconcile orphans.
 *
 * Write-lock shape: upserts stream with autocommit (one short lock per
 * batch). The import row stays `running` until `commitImport`, a single short
 * immediate transaction holding the orphan deletes and the `success` flip, so
 * an interrupted run is never recorded as a finished extraction.
 */
export function runFullSync(db: Db, realmPath: string): SyncResult {
  const importRow = claimImport(db, "full");
  const touch = createImportProgressTouch(db, importRow.id);

  let realm: Realm | undefined;
  try {
    realm = openRealm(realmPath, db);
    const actual = assertSchemaVersion(realm);
    setImportSchemaVersion(db, importRow.id, actual);

    // Stream class-by-class in bounded batches. Only the ID sets (needed for
    // orphan deletion) and running watermarks are kept across passes — never
    // all mapped rows.
    const rulesetsUpserted = streamMappedUpsert(
      db,
      rulesets,
      realm.objects("Ruleset"),
      (obj) => mapRuleset(obj as never) as Record<string, unknown> | null,
      ["shortName"],
      undefined,
      touch,
    );

    const realmSetIds = new Set<string>();
    const beatmapSetsUpserted = streamMappedUpsert(
      db,
      beatmapSets,
      realm.objects("BeatmapSet"),
      (obj) => {
        const row = mapBeatmapSet(obj as never);
        if (row) realmSetIds.add(row.id);
        return row as Record<string, unknown> | null;
      },
      ["id"],
      undefined,
      touch,
    );

    const realmBeatmapIds = new Set<string>();
    let maxLastLocalUpdate: Date | null = null;
    const beatmapsUpserted = streamMappedUpsert(
      db,
      beatmaps,
      realm.objects("Beatmap"),
      (obj) => {
        const row = mapBeatmap(obj as never);
        if (row) realmBeatmapIds.add(row.id);
        return row as Record<string, unknown> | null;
      },
      ["id"],
      (row) => {
        maxLastLocalUpdate = laterDate(
          maxLastLocalUpdate,
          row.lastLocalUpdate as Date | number | null,
        );
      },
      touch,
    );

    const realmScoreIds = new Set<string>();
    let maxPlayedAt: Date | null = null;
    const scoresUpserted = streamMappedUpsert(
      db,
      scores,
      realm.objects("Score"),
      (obj) => {
        const row = mapScore(obj as never);
        if (!row) return null;
        realmScoreIds.add(row.id);
        if (row.beatmapId && !realmBeatmapIds.has(row.beatmapId)) {
          row.beatmapId = null;
        }
        return row as Record<string, unknown>;
      },
      ["id"],
      (row) => {
        maxPlayedAt = laterDate(
          maxPlayedAt,
          row.playedAt as Date | number | null,
        );
      },
      touch,
    );

    // Commit phase: orphan deletes + `success` flip + watermarks, atomically.
    // Full bootstrap → null delta (server runs full analytics).
    const { deleted, rowsChanged } = commitImport(db, importRow.id, (tx) => {
      const deleted = reconcileDeletes(
        tx,
        realmScoreIds,
        realmBeatmapIds,
        realmSetIds,
      );
      const rowsChanged =
        rulesetsUpserted.changed +
        beatmapSetsUpserted.changed +
        beatmapsUpserted.changed +
        scoresUpserted.changed +
        deleted.scoresDeleted +
        deleted.beatmapsDeleted +
        deleted.beatmapSetsDeleted;
      return {
        counts: {
          beatmapSetsUpserted: beatmapSetsUpserted.attempted,
          beatmapsUpserted: beatmapsUpserted.attempted,
          scoresUpserted: scoresUpserted.attempted,
          rowsChanged,
          scoresDeleted: deleted.scoresDeleted,
          beatmapsDeleted: deleted.beatmapsDeleted,
          beatmapSetsDeleted: deleted.beatmapSetsDeleted,
          changedScoreIds: null,
          changedBeatmapIds: null,
        },
        watermarks: { maxPlayedAt, maxLastLocalUpdate },
        result: { deleted, rowsChanged },
      };
    });

    trySyncRealmCollections(db, realm, true);
    trySyncRealmSkins(db, realm);

    return {
      kind: "full",
      beatmapSetsUpserted: beatmapSetsUpserted.attempted,
      beatmapsUpserted: beatmapsUpserted.attempted,
      scoresUpserted: scoresUpserted.attempted,
      rulesetsUpserted: rulesetsUpserted.attempted,
      rowsChanged,
      scoresDeleted: deleted.scoresDeleted,
      beatmapsDeleted: deleted.beatmapsDeleted,
      beatmapSetsDeleted: deleted.beatmapSetsDeleted,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    failImport(db, importRow.id, err);
    throw err;
  } finally {
    realm?.close();
  }
}

/**
 * Periodic orphan check + missing-ID catch-up (no full remapping of all rows).
 * Soft-delete / hidden flags are healed by id-set comparison (not counts).
 *
 * Streaming phases (catch-up, flag heal, one-shot replay backfill) autocommit
 * in bounded batches; orphan deletes, the stall counter, the one-shot flag and
 * the `success` flip commit together in `commitImport`.
 */
export function runReconcileSync(db: Db, realmPath: string): SyncResult {
  const importRow = claimImport(db, "reconcile");
  const touch = createImportProgressTouch(db, importRow.id);

  let realm: Realm | undefined;
  try {
    const open = openRealm(realmPath, db);
    realm = open;
    const actual = assertSchemaVersion(open);
    setImportSchemaVersion(db, importRow.id, actual);

    const realmCounts: RealmCounts = {
      scores: open.objects("Score").length,
      beatmaps: open.objects("Beatmap").length,
      sets: open.objects("BeatmapSet").length,
    };

    // Counts differ → catch up missing Realm rows (unless the stall breaker
    // tripped) and, in the commit phase, delete SQLite orphans.
    const round = startCountGapRound(db, realmCounts, {
      collectRealmIdSets: () => collectRealmIdSets(open),
      catchUp: (ids) => catchUpMissingFromRealm(db, open, ids, touch),
    });
    const caughtUp = round.caughtUp;

    // Soft-delete / hide flags: remap ids that differ between Realm and the
    // local mirror. Realm Beatmap has no DeletePending — difficulty hide uses
    // Hidden.
    const source = realmSource(open);
    const heal = new DeltaWriter(db, source, getWatermarks(db));
    heal.onBatch = touch;
    healFlaggedRows(heal, db, source);

    // One-shot: remap all scores so replay_file_hash is populated after migration.
    let replayBackfillUpserted = 0;
    let replayBackfillRan = false;
    const backfillDone =
      db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, REPLAY_HASH_BACKFILL_KEY))
        .get()?.value === "1";
    if (!backfillDone) {
      replayBackfillUpserted = streamMappedUpsert(
        db,
        scores,
        open.objects("Score"),
        (obj) => mapScore(obj as never) as Record<string, unknown> | null,
        ["id"],
        undefined,
        touch,
      ).changed;
      replayBackfillRan = true;
    }

    const softScoreChanged = heal.totals.scores.changed;
    const softSetChanged = heal.totals.sets.changed;
    const softBeatmapHiddenChanged = heal.totals.beatmaps.changed;

    const deleted = commitImport(db, importRow.id, (tx) => {
      const deleted = finishCountGapRound(tx, round, realmCounts);
      // The flag is written only with the commit: a crash after the backfill
      // stream but before `success` must run the backfill (and its null
      // analytics delta) again.
      if (replayBackfillRan) {
        tx.insert(settings)
          .values({ key: REPLAY_HASH_BACKFILL_KEY, value: "1" })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: "1" },
          })
          .run();
      }

      const rowsChanged =
        deleted.scoresDeleted +
        deleted.beatmapsDeleted +
        deleted.beatmapSetsDeleted +
        caughtUp.rowsChanged +
        softScoreChanged +
        softSetChanged +
        softBeatmapHiddenChanged +
        replayBackfillUpserted;

      const healedScoreIds = heal.changedScores.toList();
      const healedBeatmapIds = heal.changedBeatmaps.toList();

      return {
        counts: {
          beatmapSetsUpserted: caughtUp.beatmapSetsUpserted,
          beatmapsUpserted:
            caughtUp.beatmapsUpserted + softBeatmapHiddenChanged,
          scoresUpserted: caughtUp.scoresUpserted + replayBackfillUpserted,
          rowsChanged,
          scoresDeleted: deleted.scoresDeleted,
          beatmapsDeleted: deleted.beatmapsDeleted,
          beatmapSetsDeleted: deleted.beatmapSetsDeleted,
          // Full remapping (or too many ids) → null delta so analytics rebuilds.
          changedScoreIds:
            replayBackfillRan || healedScoreIds == null
              ? null
              : [
                  ...deleted.deletedScoreIds,
                  ...caughtUp.changedScoreIds,
                  ...healedScoreIds,
                ],
          changedBeatmapIds:
            healedBeatmapIds == null
              ? null
              : [
                  ...deleted.deletedBeatmapIds,
                  ...caughtUp.changedBeatmapIds,
                  ...healedBeatmapIds,
                ],
        },
        // Reconcile never advances the incremental cursor.
        watermarks: getWatermarks(tx),
        result: { deleted, rowsChanged },
      };
    });

    trySyncRealmCollections(db, open, true);
    trySyncRealmSkins(db, open);

    return {
      kind: "reconcile",
      beatmapSetsUpserted: caughtUp.beatmapSetsUpserted,
      beatmapsUpserted: caughtUp.beatmapsUpserted,
      scoresUpserted: caughtUp.scoresUpserted + replayBackfillUpserted,
      rulesetsUpserted: caughtUp.rulesetsUpserted,
      rowsChanged: deleted.rowsChanged,
      scoresDeleted: deleted.deleted.scoresDeleted,
      beatmapsDeleted: deleted.deleted.beatmapsDeleted,
      beatmapSetsDeleted: deleted.deleted.beatmapSetsDeleted,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    failImport(db, importRow.id, err);
    throw err;
  } finally {
    realm?.close();
  }
}

/**
 * Watermark delta, streamed in bounded batches with per-batch dependency
 * hydration. Batches autocommit; the watermark lands only with the commit
 * phase, so an interrupted run re-reads the same delta (upserts are idempotent).
 */
export function runIncrementalSync(db: Db, realmPath: string): SyncResult {
  const watermarks = getWatermarks(db);
  if (watermarks.maxPlayedAt == null && watermarks.maxLastLocalUpdate == null) {
    return runFullSync(db, realmPath);
  }

  const importRow = claimImport(db, "incremental");
  const touch = createImportProgressTouch(db, importRow.id);

  let realm: Realm | undefined;
  try {
    const open = openRealm(realmPath, db);
    realm = open;
    const actual = assertSchemaVersion(open);
    setImportSchemaVersion(db, importRow.id, actual);

    const writer = streamIncrementalDelta(db, realmSource(open), watermarks, touch);

    commitImport(db, importRow.id, (tx) => {
      // Missed rows (e.g. lazer wrote mid-window) are healed by the periodic
      // reconcile's catch-up — not re-scanned here every cycle.
      if (writer.rowsChanged > 0) clearCatchupStallIfSet(tx);
      return {
        counts: {
          beatmapSetsUpserted: writer.totals.sets.attempted,
          beatmapsUpserted: writer.totals.beatmaps.attempted,
          scoresUpserted: writer.totals.scores.attempted,
          rowsChanged: writer.rowsChanged,
          scoresDeleted: 0,
          beatmapsDeleted: 0,
          beatmapSetsDeleted: 0,
          changedScoreIds: writer.changedScores.toList(),
          changedBeatmapIds: writer.changedBeatmaps.toList(),
        },
        watermarks: writer.watermarks,
        result: undefined,
      };
    });

    trySyncRealmCollections(db, open, false);

    return {
      kind: "incremental",
      beatmapSetsUpserted: writer.totals.sets.attempted,
      beatmapsUpserted: writer.totals.beatmaps.attempted,
      scoresUpserted: writer.totals.scores.attempted,
      rulesetsUpserted: writer.totals.rulesets.attempted,
      rowsChanged: writer.rowsChanged,
      scoresDeleted: 0,
      beatmapsDeleted: 0,
      beatmapSetsDeleted: 0,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    failImport(db, importRow.id, err);
    throw err;
  } finally {
    realm?.close();
  }
}

export function defaultRealmPath(): string {
  // Env-only fallback for scripts that do not open settings; prefer resolveRealmPathFromDb.
  if (process.env.REALM_PATH) return process.env.REALM_PATH;
  if (process.env.OSU_DATA_PATH) {
    return path.join(process.env.OSU_DATA_PATH, "client.realm");
  }
  return path.join(platformDefaultOsuDataPath(), "client.realm");
}
