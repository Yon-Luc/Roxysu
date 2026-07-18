import {
  beatmapSets,
  beatmaps,
  imports,
  rulesets,
  scores,
  getTableColumns,
  sql,
  eq,
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
  const columns = getTableColumns(table) as Record<
    string,
    { name: string }
  >;
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

export type SyncResult = {
  beatmapSetsUpserted: number;
  beatmapsUpserted: number;
  scoresUpserted: number;
  rulesetsUpserted: number;
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

export function runFullSync(db: Db, realmPath: string): SyncResult {
  const expected = loadOsuSchema().schemaVersion;
  const realm = openRealm(realmPath);

  const actual = realm.schemaVersion;
  if (actual !== expected) {
    realm.close();
    const err = new SchemaVersionMismatchError(expected, actual);
    db.insert(imports)
      .values({
        kind: "full",
        status: "failed",
        startedAt: new Date(),
        finishedAt: new Date(),
        realmSchemaVersion: actual,
        error: err.message,
      })
      .run();
    throw err;
  }

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
    const rulesetRows: RulesetRow[] = [];
    for (const obj of realm.objects("Ruleset")) {
      const row = mapRuleset(obj as never);
      if (row) rulesetRows.push(row);
    }

    const setRows: BeatmapSetRow[] = [];
    for (const obj of realm.objects("BeatmapSet")) {
      const row = mapBeatmapSet(obj as never);
      if (row) setRows.push(row);
    }

    const beatmapRows: BeatmapRow[] = [];
    for (const obj of realm.objects("Beatmap")) {
      const row = mapBeatmap(obj as never);
      if (row) beatmapRows.push(row);
    }

    const beatmapIds = new Set(beatmapRows.map((b) => b.id));
    const scoreRows: ScoreRow[] = [];
    for (const obj of realm.objects("Score")) {
      const row = mapScore(obj as never);
      if (!row) continue;
      if (row.beatmapId && !beatmapIds.has(row.beatmapId)) {
        row.beatmapId = null;
      }
      scoreRows.push(row);
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

    db.update(imports)
      .set({
        status: "success",
        finishedAt: new Date(),
        beatmapSetsUpserted,
        beatmapsUpserted,
        scoresUpserted,
      })
      .where(eq(imports.id, importRow.id))
      .run();

    return {
      beatmapSetsUpserted,
      beatmapsUpserted,
      scoresUpserted,
      rulesetsUpserted,
      realmSchemaVersion: actual,
    };
  } catch (err) {
    db.update(imports)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(imports.id, importRow.id))
      .run();
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
