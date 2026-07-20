import {
  beatmapSets,
  beatmaps,
  beatmapDanRatings,
  beatmapPatternAnalysis,
  imports,
  mastery,
  notes,
  beatmapTags,
  rulesets,
  scoreMetrics,
  scores,
  settings,
  getTableColumns,
  sql,
  eq,
  max,
  and,
  desc,
  inArray,
  count,
  type Db,
} from "@roxysu/db/client.node";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const BATCH_SIZE = 500;

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

function isSqliteBusy(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("database is locked") || lower.includes("sqlite_busy");
}

/** Sync sleep for busy-retry backoff (better-sqlite3 is synchronous). */
function sleepSync(ms: number) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

const BUSY_RETRIES = 8;

function withBusyRetry<T>(fn: () => T): T {
  let lastErr: unknown;
  for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusy(err) || attempt === BUSY_RETRIES - 1) throw err;
      const delay =
        Math.min(2_000, 50 * 2 ** attempt) + Math.floor(Math.random() * 50);
      sleepSync(delay);
    }
  }
  throw lastErr;
}

/** Build onConflictDoUpdate `set` for every column except the primary key(s). */
function conflictSet(
  table: Parameters<typeof getTableColumns>[0],
  primaryKeyNames: string[],
): Record<string, ReturnType<typeof sql.raw>> {
  const columns = getTableColumns(table);
  const set: Record<string, ReturnType<typeof sql.raw>> = {};
  for (const [name, col] of Object.entries(columns)) {
    if (primaryKeyNames.includes(name)) continue;
    set[name] = sql.raw(`excluded.\`${col.name}\``);
  }
  return set;
}

function sqliteTableName(
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
): string {
  if (table === rulesets) return "rulesets";
  if (table === beatmapSets) return "beatmap_sets";
  if (table === beatmaps) return "beatmaps";
  return "scores";
}

/** Only apply conflict updates when at least one non-PK column differs. */
function conflictSetWhere(
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  primaryKeyNames: string[],
) {
  const columns = getTableColumns(table);
  const resolvedName = sqliteTableName(table);

  const parts: ReturnType<typeof sql>[] = [];
  for (const [name, col] of Object.entries(columns)) {
    if (primaryKeyNames.includes(name)) continue;
    parts.push(
      sql.raw(
        `excluded.\`${col.name}\` IS DISTINCT FROM \`${resolvedName}\`.\`${col.name}\``,
      ),
    );
  }
  if (parts.length === 0) return undefined;
  return sql.join(parts, sql` OR `);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type UpsertResult = {
  attempted: number;
  changed: number;
};

function upsertBatches(
  db: Db,
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  rows: Record<string, unknown>[],
  primaryKeyNames: string[],
): UpsertResult {
  if (rows.length === 0) return { attempted: 0, changed: 0 };
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const targetCols = primaryKeyNames.map((k) => {
    const col = columns[k];
    if (!col) throw new Error(`unknown primary key column: ${k}`);
    return col;
  });
  const target = targetCols.length === 1 ? targetCols[0]! : targetCols;
  const set = conflictSet(table, primaryKeyNames);
  const setWhere = conflictSetWhere(table, primaryKeyNames);

  let changed = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const result = withBusyRetry(() =>
      db
        .insert(table)
        .values(batch as never[])
        .onConflictDoUpdate({
          target: target as never,
          set: set as never,
          ...(setWhere ? { setWhere } : {}),
        })
        .run(),
    );
    changed += result.changes;
  }
  return { attempted: rows.length, changed };
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

function getWatermarks(db: Db): {
  maxPlayedAt: Date | null;
  maxLastLocalUpdate: Date | null;
} {
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

function collectMappedRows(realm: Realm): {
  rulesetRows: RulesetRow[];
  setRows: BeatmapSetRow[];
  beatmapRows: BeatmapRow[];
  scoreRows: ScoreRow[];
  realmScoreIds: Set<string>;
  realmBeatmapIds: Set<string>;
  realmSetIds: Set<string>;
} {
  const rulesetRows: RulesetRow[] = [];
  for (const obj of realm.objects("Ruleset")) {
    const row = mapRuleset(obj as never);
    if (row) rulesetRows.push(row);
  }

  const setRows: BeatmapSetRow[] = [];
  const realmSetIds = new Set<string>();
  for (const obj of realm.objects("BeatmapSet")) {
    const row = mapBeatmapSet(obj as never);
    if (row) {
      setRows.push(row);
      realmSetIds.add(row.id);
    }
  }

  const beatmapRows: BeatmapRow[] = [];
  const realmBeatmapIds = new Set<string>();
  for (const obj of realm.objects("Beatmap")) {
    const row = mapBeatmap(obj as never);
    if (row) {
      beatmapRows.push(row);
      realmBeatmapIds.add(row.id);
    }
  }

  const scoreRows: ScoreRow[] = [];
  const realmScoreIds = new Set<string>();
  for (const obj of realm.objects("Score")) {
    const row = mapScore(obj as never);
    if (!row) continue;
    if (row.beatmapId && !realmBeatmapIds.has(row.beatmapId)) {
      row.beatmapId = null;
    }
    scoreRows.push(row);
    realmScoreIds.add(row.id);
  }

  return {
    rulesetRows,
    setRows,
    beatmapRows,
    scoreRows,
    realmScoreIds,
    realmBeatmapIds,
    realmSetIds,
  };
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

  const missingSetIds = idsMissingFromSqlite(realmIds.realmSetIds, sqliteSetIds);
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
    deleteByIds(db, beatmapTags, beatmapTags.beatmapId as never, orphanBeatmaps);
    deleteByIds(
      db,
      beatmapDanRatings,
      beatmapDanRatings.beatmapId as never,
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

    const collected = collectMappedRows(realm);

    const rulesetsUpserted = upsertBatches(
      db,
      rulesets,
      collected.rulesetRows as Record<string, unknown>[],
      ["shortName"],
    );
    const beatmapSetsUpserted = upsertBatches(
      db,
      beatmapSets,
      collected.setRows as Record<string, unknown>[],
      ["id"],
    );
    const beatmapsUpserted = upsertBatches(
      db,
      beatmaps,
      collected.beatmapRows as Record<string, unknown>[],
      ["id"],
    );
    const scoresUpserted = upsertBatches(
      db,
      scores,
      collected.scoreRows as Record<string, unknown>[],
      ["id"],
    );

    const deleted = reconcileDeletes(
      db,
      collected.realmScoreIds,
      collected.realmBeatmapIds,
      collected.realmSetIds,
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
    finishImport(db, importRow.id, {
      beatmapSetsUpserted: beatmapSetsUpserted.attempted,
      beatmapsUpserted: beatmapsUpserted.attempted,
      scoresUpserted: scoresUpserted.attempted,
      rowsChanged,
      scoresDeleted: deleted.scoresDeleted,
      beatmapsDeleted: deleted.beatmapsDeleted,
      beatmapSetsDeleted: deleted.beatmapSetsDeleted,
      changedScoreIds: null,
      changedBeatmapIds: null,
    });

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
    if (
      sqliteScoreCount !== realmScoreCount ||
      sqliteBeatmapCount !== realmBeatmapCount ||
      sqliteSetCount !== realmSetCount
    ) {
      const ids = collectRealmIdSets(realm);
      caughtUp = catchUpMissingFromRealm(db, realm, ids);
      deleted = reconcileDeletes(
        db,
        ids.realmScoreIds,
        ids.realmBeatmapIds,
        ids.realmSetIds,
      );
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
      const scoreRows: ScoreRow[] = [];
      for (const obj of realm.objects("Score")) {
        const row = mapScore(obj as never);
        if (row) scoreRows.push(row);
      }
      replayBackfillUpserted = upsertBatches(
        db,
        scores,
        scoreRows as Record<string, unknown>[],
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

    finishImport(db, importRow.id, {
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
    });

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

    // Heal maps/scores the watermark missed (null LastLocalUpdate, clock ties, etc.).
    let caughtUp = {
      beatmapSetsUpserted: 0,
      beatmapsUpserted: 0,
      scoresUpserted: 0,
      rulesetsUpserted: 0,
      changedBeatmapIds: [] as string[],
      changedScoreIds: [] as string[],
      rowsChanged: 0,
    };
    const sqliteScoreCount =
      db.select({ n: count() }).from(scores).get()?.n ?? 0;
    const sqliteBeatmapCount =
      db.select({ n: count() }).from(beatmaps).get()?.n ?? 0;
    const sqliteSetCount =
      db.select({ n: count() }).from(beatmapSets).get()?.n ?? 0;
    if (
      realm.objects("Score").length !== sqliteScoreCount ||
      realm.objects("Beatmap").length !== sqliteBeatmapCount ||
      realm.objects("BeatmapSet").length !== sqliteSetCount
    ) {
      caughtUp = catchUpMissingFromRealm(db, realm, collectRealmIdSets(realm));
    }

    const rowsChanged =
      rulesetsUpserted.changed +
      beatmapSetsUpserted.changed +
      beatmapsUpserted.changed +
      scoresUpserted.changed +
      caughtUp.rowsChanged;

    const changedScoreIds = [...scoreIds, ...caughtUp.changedScoreIds];
    const changedBeatmapIds = [...beatmapIds, ...caughtUp.changedBeatmapIds];

    finishImport(db, importRow.id, {
      beatmapSetsUpserted:
        beatmapSetsUpserted.attempted + caughtUp.beatmapSetsUpserted,
      beatmapsUpserted: beatmapsUpserted.attempted + caughtUp.beatmapsUpserted,
      scoresUpserted: scoresUpserted.attempted + caughtUp.scoresUpserted,
      rowsChanged,
      scoresDeleted: 0,
      beatmapsDeleted: 0,
      beatmapSetsDeleted: 0,
      // If nothing actually wrote, empty arrays → analytics can no-op via rowsChanged.
      changedScoreIds: rowsChanged > 0 ? changedScoreIds : [],
      changedBeatmapIds: rowsChanged > 0 ? changedBeatmapIds : [],
    });

    return {
      kind: "incremental",
      beatmapSetsUpserted:
        beatmapSetsUpserted.attempted + caughtUp.beatmapSetsUpserted,
      beatmapsUpserted: beatmapsUpserted.attempted + caughtUp.beatmapsUpserted,
      scoresUpserted: scoresUpserted.attempted + caughtUp.scoresUpserted,
      rulesetsUpserted:
        rulesetsUpserted.attempted + caughtUp.rulesetsUpserted,
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

export function defaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../server/data.sqlite");
}
