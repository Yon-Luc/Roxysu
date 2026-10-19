import { backupThenOpenForWrite } from "./backupBeforeWrite";
import { imports, scores, eq, desc, type Db } from "@roxysu/db/client.node";
import Realm from "realm";
import { mapScore } from "./map";
import { loadOsuSchema } from "./schema";
import {
  RealmLockedError,
  SchemaVersionMismatchError,
  recordSchemaOutdated,
  toSchemaVersionMismatchError,
} from "./sync";
import { upsertBatches } from "./upsert";

export type OnlineScoreWriteRow = {
  scoreId: number;
  legacyScoreId: number;
  beatmapOnlineId: number;
  checksum: string | null;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  totalScore: number;
  totalScoreWithoutMods: number;
  legacyTotalScore: number | null;
  rank: number;
  modsJson: string;
  statistics: Record<string, number>;
  maximumStatistics: Record<string, number> | null;
  objectCount: number;
  endedAtMs: number;
  username: string;
  userOnlineId: number;
  ruleset: string;
  isLegacy: boolean;
};

export type OnlineScoreWritePayload = {
  userOnlineId: number;
  username: string;
  countryCode: string | null;
  rows: OnlineScoreWriteRow[];
};

export type OnlineScoreWriteResult =
  | {
      ok: true;
      added: number;
      skipped: number;
      backupPath: string;
      scoreIds: string[];
    }
  | { ok: false; error: string; code: "locked" | "schema_mismatch" | "other" };

const HIT = ["miss", "meh", "ok", "good", "great", "perfect"] as const;
const PASCAL: Record<string, string> = {
  miss: "Miss",
  meh: "Meh",
  ok: "Ok",
  good: "Good",
  great: "Great",
  perfect: "Perfect",
};
const ENUM_INT: Record<string, number> = {
  miss: 1,
  meh: 2,
  ok: 3,
  good: 4,
  great: 5,
  perfect: 6,
};
const LATEST_SCORE_VERSION = 30000019;
const FULL_ANALYTICS_ID_THRESHOLD = 5_000;

type RealmObj = Realm.Object & Record<string, unknown>;

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

function openRealmForWrite(realmPath: string): Realm {
  const { schemaVersion, schema } = loadOsuSchema();
  try {
    return new Realm({ path: realmPath, schema, schemaVersion, readOnly: false });
  } catch (err) {
    const mismatch = toSchemaVersionMismatchError(err);
    if (mismatch) throw mismatch;
    if (isLockError(err)) {
      throw new RealmLockedError(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

function statStyle(sample: string | null): "pascal" | "lower" | "int" {
  if (!sample) return "pascal";
  if (/"\d+"\s*:/.test(sample)) return "int";
  if (sample.includes('"Miss"') || sample.includes('"Great"')) return "pascal";
  if (sample.includes('"miss"') || sample.includes('"great"')) return "lower";
  return "pascal";
}

function statsJson(
  stats: Record<string, number>,
  style: "pascal" | "lower" | "int",
  fallbackPerfect: number,
): string {
  const out: Record<string, number> = {};
  for (const key of HIT) {
    const value = stats[key] ?? 0;
    if (value <= 0) continue;
    const name =
      style === "int" ? String(ENUM_INT[key]) : style === "lower" ? key : PASCAL[key]!;
    out[name] = value;
  }
  if (Object.keys(out).length === 0) {
    const name = style === "int" ? "6" : style === "lower" ? "perfect" : "Perfect";
    out[name] = Math.max(1, fallbackPerfect);
  }
  return JSON.stringify(out);
}

function findBeatmap(realm: Realm, onlineId: number, checksum: string | null): RealmObj | null {
  const maps = realm.objects<RealmObj>("Beatmap").filtered("OnlineID == $0", onlineId);
  if (maps.length === 0) return null;
  if (checksum) {
    const want = checksum.toLowerCase();
    for (const map of maps) {
      const md5 = String(map.MD5Hash ?? "").toLowerCase();
      if (md5 && md5 === want) return map;
    }
  }
  for (const map of maps) {
    if (typeof map.Hash === "string" && map.Hash.length > 0) return map;
  }
  return maps[0] ?? null;
}

function sampleStatistics(realm: Realm): string | null {
  const rows = realm.objects<RealmObj>("Score");
  for (const row of rows) {
    if (typeof row.Statistics === "string" && row.Statistics.includes("{")) {
      return row.Statistics;
    }
  }
  return null;
}

function existingOnlineIds(realm: Realm): { online: Set<number>; legacy: Set<number> } {
  const online = new Set<number>();
  const legacy = new Set<number>();
  for (const row of realm.objects<RealmObj>("Score")) {
    const id = Number(row.OnlineID ?? 0);
    const legacyId = Number(row.LegacyOnlineID ?? 0);
    if (id > 0) online.add(id);
    if (legacyId > 0) legacy.add(legacyId);
  }
  return { online, legacy };
}

export function runOnlineScoreWrite(
  db: Db,
  dbPath: string,
  realmPath: string,
  payload: OnlineScoreWritePayload,
): OnlineScoreWriteResult {
  let realm: Realm | null = null;
  try {
    const opened = backupThenOpenForWrite(realmPath, dbPath, {
      openForWrite: openRealmForWrite,
      assertSchema: (probe) => {
        const expected = loadOsuSchema().schemaVersion;
        if (probe.schemaVersion !== expected) {
          throw new SchemaVersionMismatchError(expected, probe.schemaVersion);
        }
      },
    });
    realm = opened.realm;
    const backupPath = opened.backupPath;
    const style = statStyle(sampleStatistics(realm));
    const taken = existingOnlineIds(realm);
    const rulesetCache = new Map<string, RealmObj>();
    const created: RealmObj[] = [];
    const mirrorAlso: RealmObj[] = [];
    let skipped = 0;

    for (const row of payload.rows) {
      if (taken.online.has(row.scoreId)) {
        const existing = realm
          .objects<RealmObj>("Score")
          .filtered("OnlineID == $0", row.scoreId)[0];
        if (existing) mirrorAlso.push(existing);
      }
    }

    realm.write(() => {
      for (const row of payload.rows) {
        if (taken.online.has(row.scoreId) || (row.legacyScoreId > 0 && taken.legacy.has(row.legacyScoreId))) {
          skipped += 1;
          continue;
        }
        const beatmap = findBeatmap(realm!, row.beatmapOnlineId, row.checksum);
        const beatmapHash = beatmap ? String(beatmap.Hash ?? "") : "";
        if (!beatmap || !beatmapHash) {
          skipped += 1;
          continue;
        }
        let ruleset = rulesetCache.get(row.ruleset);
        if (!ruleset) {
          ruleset =
            realm!.objectForPrimaryKey<RealmObj>("Ruleset", row.ruleset) ?? undefined;
          if (!ruleset) {
            skipped += 1;
            continue;
          }
          rulesetCache.set(row.ruleset, ruleset);
        }
        const id = new Realm.BSON.UUID();
        const maximum = row.maximumStatistics ?? { perfect: row.objectCount || row.maxCombo || 1 };
        realm!.create("Score", {
          ID: id,
          BeatmapInfo: beatmap,
          ClientVersion: "",
          BeatmapHash: beatmapHash,
          Ruleset: ruleset,
          Files: [],
          Hash: "",
          DeletePending: false,
          TotalScore: row.totalScore,
          TotalScoreWithoutMods: row.totalScoreWithoutMods,
          TotalScoreVersion: LATEST_SCORE_VERSION,
          LegacyTotalScore: row.legacyTotalScore,
          BackgroundReprocessingFailed: false,
          MaxCombo: row.maxCombo,
          Accuracy: row.accuracy,
          Date: new Date(row.endedAtMs),
          PP: row.pp,
          OnlineID: row.scoreId,
          LegacyOnlineID: row.legacyScoreId > 0 ? row.legacyScoreId : -1,
          User: {
            OnlineID: payload.userOnlineId,
            Username: payload.username,
            CountryCode: payload.countryCode ?? "",
          },
          Mods: row.modsJson || "[]",
          Statistics: statsJson(row.statistics, style, 1),
          MaximumStatistics: statsJson(maximum, style, row.objectCount || 1),
          Rank: row.rank,
          Combo: row.maxCombo,
          IsLegacyScore: row.isLegacy,
          Pauses: [],
        });
        taken.online.add(row.scoreId);
        if (row.legacyScoreId > 0) taken.legacy.add(row.legacyScoreId);
        const stored = realm!.objectForPrimaryKey<RealmObj>("Score", id);
        if (stored) created.push(stored);
      }
    });

    const scoreRows = [...created, ...mirrorAlso]
      .map((obj) => mapScore(obj as never))
      .filter((row): row is NonNullable<typeof row> => row != null);
    const upserted = upsertBatches(
      db,
      scores,
      scoreRows as Record<string, unknown>[],
      ["id"],
    );
    const scoreIds = scoreRows.map((row) => row.id);
    const last = db
      .select({
        watermarkPlayedAt: imports.watermarkPlayedAt,
        watermarkLastLocalUpdate: imports.watermarkLastLocalUpdate,
        realmSchemaVersion: imports.realmSchemaVersion,
      })
      .from(imports)
      .where(eq(imports.status, "success"))
      .orderBy(desc(imports.id))
      .limit(1)
      .get();
    const now = new Date();
    db.insert(imports)
      .values({
        kind: "incremental",
        status: "success",
        startedAt: now,
        finishedAt: now,
        realmSchemaVersion: last?.realmSchemaVersion ?? realm.schemaVersion,
        scoresUpserted: upserted.attempted,
        rowsChanged: upserted.changed,
        changedScoreIds:
          scoreIds.length > FULL_ANALYTICS_ID_THRESHOLD
            ? null
            : JSON.stringify(scoreIds),
        watermarkPlayedAt: last?.watermarkPlayedAt ?? null,
        watermarkLastLocalUpdate: last?.watermarkLastLocalUpdate ?? null,
      })
      .run();

    realm.close();
    realm = null;
    return {
      ok: true,
      added: created.length,
      skipped,
      backupPath,
      scoreIds,
    };
  } catch (err) {
    const mismatch = toSchemaVersionMismatchError(err);
    if (mismatch) {
      recordSchemaOutdated(db, mismatch);
      return { ok: false, error: mismatch.message, code: "schema_mismatch" };
    }
    if (err instanceof RealmLockedError || isLockError(err)) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: "locked",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "other",
    };
  } finally {
    realm?.close();
  }
}
