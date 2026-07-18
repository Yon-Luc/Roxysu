import {
  beatmapSets,
  beatmaps,
  imports,
  mastery,
  notes,
  beatmapTags,
  rulesets,
  scoreMetrics,
  scores,
  getTableColumns,
  sql,
  eq,
  max,
  and,
  desc,
  inArray,
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

const BATCH_SIZE = 500;

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function upsertBatches(
  db: Db,
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  rows: Record<string, unknown>[],
  primaryKeyNames: string[],
) {
  if (rows.length === 0) return 0;
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const targetCols = primaryKeyNames.map((k) => {
    const col = columns[k];
    if (!col) throw new Error(`unknown primary key column: ${k}`);
    return col;
  });
  const target = targetCols.length === 1 ? targetCols[0]! : targetCols;
  const set = conflictSet(table, primaryKeyNames);

  for (const batch of chunk(rows, BATCH_SIZE)) {
    db.insert(table)
      .values(batch as never[])
      .onConflictDoUpdate({
        target: target as never,
        set: set as never,
      })
      .run();
  }
  return rows.length;
}

function deleteByIds(
  db: Db,
  table: typeof scores | typeof beatmaps | typeof beatmapSets | typeof scoreMetrics | typeof mastery | typeof notes | typeof beatmapTags,
  idColumn: { name: string },
  ids: string[],
) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (const batch of chunk(ids, BATCH_SIZE)) {
    const result = db
      .delete(table)
      .where(inArray(idColumn as never, batch))
      .run();
    deleted += result.changes;
  }
  return deleted;
}

export type SyncResult = {
  kind: "full" | "incremental";
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rulesetsUpserted: number;
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

function assertSchemaVersion(realm: Realm, kind: "full" | "incremental", db: Db) {
  const expected = loadOsuSchema().schemaVersion;
  const actual = realm.schemaVersion;
  if (actual !== expected) {
    realm.close();
    const err = new SchemaVersionMismatchError(expected, actual);
    db.insert(imports)
      .values({
        kind,
        status: "failed",
        startedAt: new Date(),
        finishedAt: new Date(),
        realmSchemaVersion: actual,
        error: err.message,
      })
      .run();
    throw err;
  }
  return actual;
}

export function recordLockedImport(db: Db, errorMessage: string) {
  const expected = loadOsuSchema().schemaVersion;
  db.insert(imports)
    .values({
      kind: "full",
      status: "locked",
      startedAt: new Date(),
      finishedAt: new Date(),
      realmSchemaVersion: expected,
      error: errorMessage,
    })
    .run();
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

/** Remove SQLite rows that no longer exist in Realm (full reconcile only). */
function reconcileDeletes(
  db: Db,
  realmScoreIds: Set<string>,
  realmBeatmapIds: Set<string>,
  realmSetIds: Set<string>,
): { scoresDeleted: number; beatmapsDeleted: number; beatmapSetsDeleted: number } {
  const sqliteScoreIds = db.select({ id: scores.id }).from(scores).all().map((r) => r.id);
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
  const orphanBeatmaps = sqliteBeatmapIds.filter((id) => !realmBeatmapIds.has(id));

  if (orphanBeatmaps.length > 0) {
    // scores referencing orphan beatmaps: null out beatmap_id first
    for (const batch of chunk(orphanBeatmaps, BATCH_SIZE)) {
      db.update(scores)
        .set({ beatmapId: null })
        .where(inArray(scores.beatmapId, batch))
        .run();
      db.delete(mastery).where(inArray(mastery.beatmapId, batch)).run();
      db.delete(notes).where(inArray(notes.beatmapId, batch)).run();
      db.delete(beatmapTags).where(inArray(beatmapTags.beatmapId, batch)).run();
    }
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
  };
}

function finishImport(
  db: Db,
  importId: number,
  counts: {
    beatmapSetsUpserted: number;
    beatmapsUpserted: number;
    scoresUpserted: number;
  },
) {
  db.update(imports)
    .set({
      status: "success",
      finishedAt: new Date(),
      beatmapSetsUpserted: counts.beatmapSetsUpserted,
      beatmapsUpserted: counts.beatmapsUpserted,
      scoresUpserted: counts.scoresUpserted,
    })
    .where(eq(imports.id, importId))
    .run();
}

function failImport(db: Db, importId: number, err: unknown) {
  db.update(imports)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: err instanceof Error ? err.message : String(err),
    })
    .where(eq(imports.id, importId))
    .run();
}

export function runFullSync(db: Db, realmPath: string): SyncResult {
  const realm = openRealm(realmPath);
  const actual = assertSchemaVersion(realm, "full", db);

  const importRow = db
    .insert(imports)
    .values({
      kind: "full",
      status: "running",
      startedAt: new Date(),
      realmSchemaVersion: actual,
    })
    .returning({ id: imports.id })
    .get();

  try {
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

    finishImport(db, importRow.id, {
      beatmapSetsUpserted,
      beatmapsUpserted,
      scoresUpserted,
    });

    return {
      kind: "full",
      beatmapSetsUpserted,
      beatmapsUpserted,
      scoresUpserted,
      rulesetsUpserted,
      scoresDeleted: deleted.scoresDeleted,
      beatmapsDeleted: deleted.beatmapsDeleted,
      beatmapSetsDeleted: deleted.beatmapSetsDeleted,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    failImport(db, importRow.id, err);
    throw err;
  } finally {
    realm.close();
  }
}

export function runIncrementalSync(db: Db, realmPath: string): SyncResult {
  const watermarks = getWatermarks(db);
  // No data yet — fall back to full
  if (watermarks.maxPlayedAt == null && watermarks.maxLastLocalUpdate == null) {
    return runFullSync(db, realmPath);
  }

  const realm = openRealm(realmPath);
  const actual = assertSchemaVersion(realm, "incremental", db);

  const importRow = db
    .insert(imports)
    .values({
      kind: "incremental",
      status: "running",
      startedAt: new Date(),
      realmSchemaVersion: actual,
    })
    .returning({ id: imports.id })
    .get();

  try {
    const setIdsNeeded = new Set<string>();
    const rulesetShortNames = new Set<string>();
    const beatmapRows: BeatmapRow[] = [];
    const scoreRows: ScoreRow[] = [];
    const beatmapIds = new Set<string>();

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
        if (row.beatmapId) {
          // Ensure beatmap parent exists for new scores
          if (!beatmapIds.has(row.beatmapId)) {
            const bm = realm.objectForPrimaryKey("Beatmap", row.beatmapId);
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

    // Soft-deleted scores/sets changed without Date/LastLocalUpdate bumps —
    // also pick up DeletePending=true that we may have previously skipped.
    for (const obj of realm.objects("Score").filtered("DeletePending == true")) {
      const row = mapScore(obj as never);
      if (!row) continue;
      if (!scoreRows.some((s) => s.id === row.id)) scoreRows.push(row);
    }
    for (const obj of realm
      .objects("BeatmapSet")
      .filtered("DeletePending == true")) {
      const row = mapBeatmapSet(obj as never);
      if (row) setIdsNeeded.add(row.id);
    }

    const setRows: BeatmapSetRow[] = [];
    for (const setId of setIdsNeeded) {
      const obj = realm.objectForPrimaryKey("BeatmapSet", setId);
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

    // Null beatmap refs that still aren't in SQLite after this batch
    const knownBeatmapIds = new Set([
      ...db.select({ id: beatmaps.id }).from(beatmaps).all().map((r) => r.id),
      ...beatmapIds,
    ]);
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

    finishImport(db, importRow.id, {
      beatmapSetsUpserted,
      beatmapsUpserted,
      scoresUpserted,
    });

    return {
      kind: "incremental",
      beatmapSetsUpserted,
      beatmapsUpserted,
      scoresUpserted,
      rulesetsUpserted,
      scoresDeleted: 0,
      beatmapsDeleted: 0,
      beatmapSetsDeleted: 0,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    failImport(db, importRow.id, err);
    throw err;
  } finally {
    realm.close();
  }
}

export function defaultRealmPath(): string {
  return (
    process.env.REALM_PATH ??
    path.join(process.env.HOME ?? "", ".local/share/osu/client.realm")
  );
}

export function defaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../server/data.sqlite");
}
