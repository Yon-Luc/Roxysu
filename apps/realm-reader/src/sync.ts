import {
  beatmapSets,
  beatmaps,
  beatmapDanRatings,
  beatmapManiaRatings,
  beatmapPatternAnalysis,
  imports,
  mastery,
  notes,
  beatmapTags,
  rulesets,
  scoreMetrics,
  scores,
  settings,
  eq,
  max,
  and,
  desc,
  inArray,
  count,
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
import {
  BATCH_SIZE,
  chunk,
  streamMappedUpsert,
  upsertBatches,
  withBusyRetry,
} from "./upsert";
import { SYNC_CATCHUP_STALLED_KEY } from "@roxysu/db/settings-keys";

export { defaultDbPath } from "@roxysu/db/path";

/** One-shot flag: remapped scores after replay_file_hash column was added. */
const REPLAY_HASH_BACKFILL_KEY = "sync.replay_hash_backfill_v1";

/** Above this many changed IDs, analytics should full-rebuild (null delta payload). */
const FULL_ANALYTICS_ID_THRESHOLD = 5_000;

/** Realm uuid PKs require a BSON.UUID instance, not a plain string. */
function realmUuid(id: string): Realm.BSON.UUID {
  return new Realm.BSON.UUID(id);
}

export class RealmLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealmLockedError";
  }
}

export class SchemaVersionMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `Realm schemaVersion mismatch: expected ${expected} (from osu-client.schema.json), got ${actual}. Re-run export-schema and update mappers.`,
    );
    this.name = "SchemaVersionMismatchError";
  }
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

/** Reconcile catch-up stops retrying after this many fruitless rounds. */
const CATCHUP_STALL_LIMIT = 3;

function readStallCount(db: Db): number {
  const raw = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_CATCHUP_STALLED_KEY))
    .get()?.value;
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function writeStallCount(db: Db, n: number) {
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
function clearCatchupStallIfSet(db: Db) {
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
    | typeof beatmapManiaRatings
    | typeof beatmapPatternAnalysis,
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

export type SyncKind = "full" | "incremental" | "reconcile";

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

function openRealm(realmPath: string): Realm {
  const { schemaVersion, schema } = loadOsuSchema();
  try {
    return new Realm({
      path: realmPath,
      schema,
      schemaVersion,
      readOnly: true,
    });
  } catch (err) {
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

export function hasSuccessfulImport(db: Db): boolean {
  const row = db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.status, "success")))
    .orderBy(desc(imports.id))
    .limit(1)
    .get();
  return row != null;
}

function playedAtMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

type ExtractionWatermarks = {
  maxPlayedAt: Date | null;
  maxLastLocalUpdate: Date | null;
};

function laterDate(
  current: Date | null,
  value: Date | number | null | undefined,
): Date | null {
  const ms = playedAtMs(value);
  if (ms == null) return current;
  if (current == null || ms > current.getTime()) return new Date(ms);
  return current;
}

function advanceWatermarks(
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

function getWatermarks(db: Db): ExtractionWatermarks {
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

  if (
    lastSuccess &&
    (lastSuccess.watermarkPlayedAt != null ||
      lastSuccess.watermarkLastLocalUpdate != null)
  ) {
    return {
      maxPlayedAt:
        playedAtMs(lastSuccess.watermarkPlayedAt) != null
          ? new Date(playedAtMs(lastSuccess.watermarkPlayedAt)!)
          : null,
      maxLastLocalUpdate:
        playedAtMs(lastSuccess.watermarkLastLocalUpdate) != null
          ? new Date(playedAtMs(lastSuccess.watermarkLastLocalUpdate)!)
          : null,
    };
  }

  return fallbackWatermarksFromTables(db);
}

function withTransaction<T>(db: Db, fn: (tx: Db) => T): T {
  return withBusyRetry(() =>
    db.transaction((tx) => fn(tx as unknown as Db)),
  );
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
  );
  const beatmapSetsUpserted = upsertBatches(
    db,
    beatmapSets,
    setRows as Record<string, unknown>[],
    ["id"],
  );
  const beatmapsUpserted = upsertBatches(
    db,
    beatmaps,
    beatmapRows as Record<string, unknown>[],
    ["id"],
  );
  const scoresUpserted = upsertBatches(
    db,
    scores,
    scoreRows as Record<string, unknown>[],
    ["id"],
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

/** Remove SQLite rows that no longer exist in Realm (full/reconcile only). */
function reconcileDeletes(
  db: Db,
  realmScoreIds: Set<string>,
  realmBeatmapIds: Set<string>,
  realmSetIds: Set<string>,
): {
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  deletedScoreIds: string[];
  deletedBeatmapIds: string[];
} {
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
    deleteByIds(db, beatmaps, beatmaps.id as never, orphanBeatmaps);
  }

  const sqliteSetIds = db
    .select({ id: beatmapSets.id })
    .from(beatmapSets)
    .all()
    .map((r) => r.id);
  const orphanSets = sqliteSetIds.filter((id) => !realmSetIds.has(id));
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

function encodeChangedIds(ids: string[] | null): string | null {
  if (ids == null) return null;
  if (ids.length > FULL_ANALYTICS_ID_THRESHOLD) return null;
  return JSON.stringify(ids);
}

function finishImport(
  db: Db,
  importId: number,
  counts: {
    beatmapSetsUpserted: number;
    beatmapsUpserted: number;
    scoresUpserted: number;
    rowsChanged: number;
    scoresDeleted: number;
    beatmapsDeleted: number;
    beatmapSetsDeleted: number;
    changedScoreIds: string[] | null;
    changedBeatmapIds: string[] | null;
  },
  watermarks: ExtractionWatermarks,
) {
  withBusyRetry(() =>
    db
      .update(imports)
      .set({
        status: "success",
        finishedAt: new Date(),
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
      .where(eq(imports.id, importId))
      .run(),
  );
}

function failImport(db: Db, importId: number, err: unknown) {
  const status = err instanceof RealmLockedError ? "locked" : "failed";
  withBusyRetry(() =>
    db
      .update(imports)
      .set({
        status,
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(imports.id, importId))
      .run(),
  );
}

function claimImport(db: Db, kind: SyncKind) {
  return withBusyRetry(() =>
    db
      .insert(imports)
      .values({
        kind,
        status: "running",
        startedAt: new Date(),
        realmSchemaVersion: 0,
      })
      .returning({ id: imports.id })
      .get(),
  );
}

function setImportSchemaVersion(db: Db, importId: number, version: number) {
  withBusyRetry(() =>
    db
      .update(imports)
      .set({ realmSchemaVersion: version })
      .where(eq(imports.id, importId))
      .run(),
  );
}

/** Bootstrap / forced full: remap + upsert everything, then reconcile orphans. */
export function runFullSync(db: Db, realmPath: string): SyncResult {
  const importRow = claimImport(db, "full");

  let realm: Realm | undefined;
  try {
    realm = openRealm(realmPath);
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
    );

    const realmSetIds = new Set<string>();
    const beatmapSetsUpserted = streamMappedUpsert(
      db,
      beatmapSets,
      realm.objects("BeatmapSet"),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
      (row) => realmSetIds.add(row.id as string),
    );

    const realmBeatmapIds = new Set<string>();
    let maxLastLocalUpdate: Date | null = null;
    const beatmapsUpserted = streamMappedUpsert(
      db,
      beatmaps,
      realm.objects("Beatmap"),
      (obj) => mapBeatmap(obj as never) as Record<string, unknown> | null,
      ["id"],
      (row) => {
        realmBeatmapIds.add(row.id as string);
        maxLastLocalUpdate = laterDate(
          maxLastLocalUpdate,
          row.lastLocalUpdate as Date | number | null,
        );
      },
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
        if (row.beatmapId && !realmBeatmapIds.has(row.beatmapId)) {
          row.beatmapId = null;
        }
        return row as Record<string, unknown>;
      },
      ["id"],
      (row) => {
        realmScoreIds.add(row.id as string);
        maxPlayedAt = laterDate(
          maxPlayedAt,
          row.playedAt as Date | number | null,
        );
      },
    );

    const deleted = reconcileDeletes(
      db,
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

    // Full bootstrap → null delta (server runs full analytics).
    finishImport(
      db,
      importRow.id,
      {
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
      { maxPlayedAt, maxLastLocalUpdate },
    );

    trySyncRealmCollections(db, realm, true);

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
 * Soft-delete flags are picked up on incremental when counts diverge.
 */
export function runReconcileSync(db: Db, realmPath: string): SyncResult {
  const importRow = claimImport(db, "reconcile");

  let realm: Realm | undefined;
  try {
    realm = openRealm(realmPath);
    const actual = assertSchemaVersion(realm);
    setImportSchemaVersion(db, importRow.id, actual);

    const sqliteScoreCount =
      db.select({ n: count() }).from(scores).get()?.n ?? 0;
    const sqliteBeatmapCount =
      db.select({ n: count() }).from(beatmaps).get()?.n ?? 0;
    const sqliteSetCount =
      db.select({ n: count() }).from(beatmapSets).get()?.n ?? 0;

    const realmScoreCount = realm.objects("Score").length;
    const realmBeatmapCount = realm.objects("Beatmap").length;
    const realmSetCount = realm.objects("BeatmapSet").length;

    let deleted = {
      scoresDeleted: 0,
      beatmapsDeleted: 0,
      beatmapSetsDeleted: 0,
      deletedScoreIds: [] as string[],
      deletedBeatmapIds: [] as string[],
    };
    let caughtUp = {
      beatmapSetsUpserted: 0,
      beatmapsUpserted: 0,
      scoresUpserted: 0,
      rulesetsUpserted: 0,
      changedBeatmapIds: [] as string[],
      changedScoreIds: [] as string[],
      rowsChanged: 0,
    };

    // Counts differ → catch up missing Realm rows and/or delete SQLite orphans.
    const countsDiffer =
      sqliteScoreCount !== realmScoreCount ||
      sqliteBeatmapCount !== realmBeatmapCount ||
      sqliteSetCount !== realmSetCount;

    if (countsDiffer) {
      const stallCount = readStallCount(db);
      if (stallCount >= CATCHUP_STALL_LIMIT) {
        console.log(
          `reconcile: skipping catch-up — row-count gap survived ${stallCount} fruitless rounds (unmirrorable Realm rows?). Cleared automatically once new rows import.`,
        );
      } else {
        const ids = collectRealmIdSets(realm);
        caughtUp = catchUpMissingFromRealm(db, realm, ids);
        deleted = reconcileDeletes(
          db,
          ids.realmScoreIds,
          ids.realmBeatmapIds,
          ids.realmSetIds,
        );

        // Track whether this round closed the gap; a gap that never moves
        // must not force full-ID scans every reconcile forever.
        const scoreCountAfter =
          db.select({ n: count() }).from(scores).get()?.n ?? 0;
        const beatmapCountAfter =
          db.select({ n: count() }).from(beatmaps).get()?.n ?? 0;
        const setCountAfter =
          db.select({ n: count() }).from(beatmapSets).get()?.n ?? 0;
        const stillDiffer =
          scoreCountAfter !== realmScoreCount ||
          beatmapCountAfter !== realmBeatmapCount ||
          setCountAfter !== realmSetCount;

        if (stillDiffer) {
          const movedRows =
            caughtUp.rowsChanged +
            deleted.scoresDeleted +
            deleted.beatmapsDeleted +
            deleted.beatmapSetsDeleted;
          writeStallCount(db, movedRows > 0 ? 0 : stallCount + 1);
        } else {
          writeStallCount(db, 0);
        }
      }
    }

    // Soft-delete count gate: if pending counts diverge, map those objects.
    let softScoreChanged = 0;
    let softSetChanged = 0;
    const changedScoreIds: string[] = [
      ...deleted.deletedScoreIds,
      ...caughtUp.changedScoreIds,
    ];
    const changedBeatmapIds: string[] = [
      ...deleted.deletedBeatmapIds,
      ...caughtUp.changedBeatmapIds,
    ];

    const realmSoftScores = realm
      .objects("Score")
      .filtered("DeletePending == true");
    const realmSoftSets = realm
      .objects("BeatmapSet")
      .filtered("DeletePending == true");
    const sqliteSoftScores =
      db
        .select({ n: count() })
        .from(scores)
        .where(eq(scores.deletePending, true))
        .get()?.n ?? 0;
    const sqliteSoftSets =
      db
        .select({ n: count() })
        .from(beatmapSets)
        .where(eq(beatmapSets.deletePending, true))
        .get()?.n ?? 0;

    if (realmSoftScores.length !== sqliteSoftScores) {
      const scoreRows: ScoreRow[] = [];
      for (const obj of realmSoftScores) {
        const row = mapScore(obj as never);
        if (row) {
          scoreRows.push(row);
          changedScoreIds.push(row.id);
        }
      }
      softScoreChanged = upsertBatches(
        db,
        scores,
        scoreRows as Record<string, unknown>[],
        ["id"],
      ).changed;
    }

    if (realmSoftSets.length !== sqliteSoftSets) {
      const setRows: BeatmapSetRow[] = [];
      for (const obj of realmSoftSets) {
        const row = mapBeatmapSet(obj as never);
        if (row) setRows.push(row);
      }
      softSetChanged = upsertBatches(
        db,
        beatmapSets,
        setRows as Record<string, unknown>[],
        ["id"],
      ).changed;
    }

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
        realm.objects("Score"),
        (obj) => mapScore(obj as never) as Record<string, unknown> | null,
        ["id"],
      ).changed;
      db.insert(settings)
        .values({ key: REPLAY_HASH_BACKFILL_KEY, value: "1" })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: "1" },
        })
        .run();
      replayBackfillRan = true;
    }

    const rowsChanged =
      deleted.scoresDeleted +
      deleted.beatmapsDeleted +
      deleted.beatmapSetsDeleted +
      caughtUp.rowsChanged +
      softScoreChanged +
      softSetChanged +
      replayBackfillUpserted;

    finishImport(
      db,
      importRow.id,
      {
        beatmapSetsUpserted: caughtUp.beatmapSetsUpserted,
        beatmapsUpserted: caughtUp.beatmapsUpserted,
        scoresUpserted: caughtUp.scoresUpserted + replayBackfillUpserted,
        rowsChanged,
        scoresDeleted: deleted.scoresDeleted,
        beatmapsDeleted: deleted.beatmapsDeleted,
        beatmapSetsDeleted: deleted.beatmapSetsDeleted,
        // Full remapping → null delta so analytics rebuilds.
        changedScoreIds: replayBackfillRan ? null : changedScoreIds,
        changedBeatmapIds,
      },
      advanceWatermarks(getWatermarks(db), [], []),
    );

    trySyncRealmCollections(db, realm, true);

    return {
      kind: "reconcile",
      beatmapSetsUpserted: caughtUp.beatmapSetsUpserted,
      beatmapsUpserted: caughtUp.beatmapsUpserted,
      scoresUpserted: caughtUp.scoresUpserted + replayBackfillUpserted,
      rulesetsUpserted: caughtUp.rulesetsUpserted,
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

export function runIncrementalSync(db: Db, realmPath: string): SyncResult {
  const watermarks = getWatermarks(db);
  if (watermarks.maxPlayedAt == null && watermarks.maxLastLocalUpdate == null) {
    return runFullSync(db, realmPath);
  }

  const importRow = claimImport(db, "incremental");

  let realm: Realm | undefined;
  try {
    realm = openRealm(realmPath);
    const actual = assertSchemaVersion(realm);
    setImportSchemaVersion(db, importRow.id, actual);

    const setIdsNeeded = new Set<string>();
    const rulesetShortNames = new Set<string>();
    const beatmapRows: BeatmapRow[] = [];
    const scoreRows: ScoreRow[] = [];
    const beatmapIds = new Set<string>();
    const scoreIds = new Set<string>();

    if (watermarks.maxLastLocalUpdate) {
      const filtered = realm
        .objects("Beatmap")
        .filtered("LastLocalUpdate > $0", watermarks.maxLastLocalUpdate);
      for (const obj of filtered) {
        const row = mapBeatmap(obj as never);
        if (!row) continue;
        beatmapRows.push(row);
        beatmapIds.add(row.id);
        setIdsNeeded.add(row.setId);
        if (row.rulesetShortName) rulesetShortNames.add(row.rulesetShortName);
      }
    }

    if (watermarks.maxPlayedAt) {
      const filtered = realm
        .objects("Score")
        .filtered("Date > $0", watermarks.maxPlayedAt);
      for (const obj of filtered) {
        const row = mapScore(obj as never);
        if (!row) continue;
        scoreRows.push(row);
        scoreIds.add(row.id);
        if (row.beatmapId) {
          if (!beatmapIds.has(row.beatmapId)) {
            const bm = realm.objectForPrimaryKey(
              "Beatmap",
              realmUuid(row.beatmapId),
            );
            if (bm) {
              const mapped = mapBeatmap(bm as never);
              if (mapped) {
                beatmapRows.push(mapped);
                beatmapIds.add(mapped.id);
                setIdsNeeded.add(mapped.setId);
                if (mapped.rulesetShortName) {
                  rulesetShortNames.add(mapped.rulesetShortName);
                }
              }
            } else {
              row.beatmapId = null;
            }
          }
        }
        if (row.rulesetShortName) rulesetShortNames.add(row.rulesetShortName);
      }
    }

    // Soft-delete: only scan when Realm pending count ≠ SQLite pending count.
    const realmSoftScores = realm
      .objects("Score")
      .filtered("DeletePending == true");
    const realmSoftSets = realm
      .objects("BeatmapSet")
      .filtered("DeletePending == true");
    const sqliteSoftScores =
      db
        .select({ n: count() })
        .from(scores)
        .where(eq(scores.deletePending, true))
        .get()?.n ?? 0;
    const sqliteSoftSets =
      db
        .select({ n: count() })
        .from(beatmapSets)
        .where(eq(beatmapSets.deletePending, true))
        .get()?.n ?? 0;

    if (realmSoftScores.length !== sqliteSoftScores) {
      for (const obj of realmSoftScores) {
        const row = mapScore(obj as never);
        if (!row) continue;
        if (!scoreIds.has(row.id)) {
          scoreRows.push(row);
          scoreIds.add(row.id);
        }
      }
    }

    if (realmSoftSets.length !== sqliteSoftSets) {
      for (const obj of realmSoftSets) {
        const row = mapBeatmapSet(obj as never);
        if (row) setIdsNeeded.add(row.id);
      }
    }

    const setRows: BeatmapSetRow[] = [];
    for (const setId of setIdsNeeded) {
      const obj = realm.objectForPrimaryKey("BeatmapSet", realmUuid(setId));
      if (!obj) continue;
      const row = mapBeatmapSet(obj as never);
      if (row) setRows.push(row);
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

    // Targeted FK check: only the beatmap IDs referenced by this delta.
    const candidateBeatmapIds = [
      ...new Set(
        scoreRows
          .map((r) => r.beatmapId)
          .filter((id): id is string => id != null),
      ),
    ].filter((id) => !beatmapIds.has(id));

    const knownBeatmapIds = new Set(beatmapIds);
    for (const batch of chunk(candidateBeatmapIds, BATCH_SIZE)) {
      const found = db
        .select({ id: beatmaps.id })
        .from(beatmaps)
        .where(inArray(beatmaps.id, batch))
        .all();
      for (const row of found) knownBeatmapIds.add(row.id);
    }
    for (const row of scoreRows) {
      if (row.beatmapId && !knownBeatmapIds.has(row.beatmapId)) {
        row.beatmapId = null;
      }
    }

    let rulesetsUpserted = { attempted: 0, changed: 0 };
    let beatmapSetsUpserted = { attempted: 0, changed: 0 };
    let beatmapsUpserted = { attempted: 0, changed: 0 };
    let scoresUpserted = { attempted: 0, changed: 0 };
    let rowsChanged = 0;

    withTransaction(db, (tx) => {
      rulesetsUpserted = upsertBatches(
        tx,
        rulesets,
        rulesetRows as Record<string, unknown>[],
        ["shortName"],
      );
      beatmapSetsUpserted = upsertBatches(
        tx,
        beatmapSets,
        setRows as Record<string, unknown>[],
        ["id"],
      );
      beatmapsUpserted = upsertBatches(
        tx,
        beatmaps,
        beatmapRows as Record<string, unknown>[],
        ["id"],
      );
      scoresUpserted = upsertBatches(
        tx,
        scores,
        scoreRows as Record<string, unknown>[],
        ["id"],
      );

      // Missed rows (e.g. lazer wrote mid-window) are healed by the periodic
      // reconcile's catch-up — not re-scanned here every cycle.
      rowsChanged =
        rulesetsUpserted.changed +
        beatmapSetsUpserted.changed +
        beatmapsUpserted.changed +
        scoresUpserted.changed;

      const changedScoreIds = [...scoreIds];
      const changedBeatmapIds = [...beatmapIds];

      finishImport(
        tx,
        importRow.id,
        {
          beatmapSetsUpserted: beatmapSetsUpserted.attempted,
          beatmapsUpserted: beatmapsUpserted.attempted,
          scoresUpserted: scoresUpserted.attempted,
          rowsChanged,
          scoresDeleted: 0,
          beatmapsDeleted: 0,
          beatmapSetsDeleted: 0,
          changedScoreIds,
          changedBeatmapIds,
        },
        advanceWatermarks(watermarks, scoreRows, beatmapRows),
      );
    });

    if (rowsChanged > 0) clearCatchupStallIfSet(db);

    trySyncRealmCollections(db, realm, false);

    return {
      kind: "incremental",
      beatmapSetsUpserted: beatmapSetsUpserted.attempted,
      beatmapsUpserted: beatmapsUpserted.attempted,
      scoresUpserted: scoresUpserted.attempted,
      rulesetsUpserted: rulesetsUpserted.attempted,
      rowsChanged,
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
