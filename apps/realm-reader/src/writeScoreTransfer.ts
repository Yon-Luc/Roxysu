import { backupRealmFile } from "@roxysu/realm-backup";
import { imports, scores, eq, desc, type Db } from "@roxysu/db/client.node";
import Realm from "realm";
import { mapScore } from "./map";
import { loadOsuSchema } from "./schema";
import {
  FINGERPRINT_MS,
  classifyTransferScore,
  buildTransferIndex,
  type TransferBeatmap,
  type TransferFinger,
} from "./scoreTransferMatch";
import {
  RealmLockedError,
  SchemaVersionMismatchError,
  recordSchemaOutdated,
  toSchemaVersionMismatchError,
} from "./sync";
import { upsertBatches } from "./upsert";

export type ScoreTransferWriteRow = {
  scoreId: number;
  legacyScoreId: number;
  beatmapOnlineId: number;
  checksum: string | null;
  beatmapHash: string | null;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  combo: number;
  totalScore: number;
  totalScoreWithoutMods: number;
  legacyTotalScore: number | null;
  rank: number;
  modsJson: string;
  statisticsJson: string | null;
  maximumStatisticsJson: string | null;
  endedAtMs: number;
  username: string;
  userOnlineId: number;
  ruleset: string;
  isLegacy: boolean;
  clientVersion: string;
};

export type ScoreTransferWritePayload = {
  rows: ScoreTransferWriteRow[];
};

export type ScoreTransferWriteResult =
  | {
      ok: true;
      added: number;
      skipped: number;
      backupPath: string;
      scoreIds: string[];
    }
  | { ok: false; error: string; code: "locked" | "schema_mismatch" | "other" };

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

function dateMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const n = new Date(value as string | number).getTime();
  return Number.isFinite(n) ? n : 0;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fingerFromRealm(obj: RealmObj): TransferFinger {
  const beatmap = obj.BeatmapInfo as RealmObj | null | undefined;
  const ruleset = obj.Ruleset as RealmObj | null | undefined;
  const hash = textOrNull(obj.BeatmapHash) ?? textOrNull(beatmap?.Hash);
  return {
    onlineId: Number(obj.OnlineID ?? 0),
    legacyOnlineId: Number(obj.LegacyOnlineID ?? 0),
    beatmapOnlineId: Number(beatmap?.OnlineID ?? 0),
    beatmapMd5: textOrNull(beatmap?.MD5Hash),
    beatmapHash: hash,
    ruleset: typeof ruleset?.ShortName === "string" ? ruleset.ShortName : "",
    playedAtMs: dateMs(obj.Date),
    totalScore: Number(obj.TotalScore ?? 0),
    legacyTotalScore:
      obj.LegacyTotalScore != null ? Number(obj.LegacyTotalScore) : null,
  };
}

function beatmapRef(obj: RealmObj): TransferBeatmap | null {
  const hash = textOrNull(obj.Hash);
  if (!hash) return null;
  return {
    onlineId: Number(obj.OnlineID ?? 0),
    md5Hash: textOrNull(obj.MD5Hash),
    hash,
  };
}

function fingerFromRow(row: ScoreTransferWriteRow): TransferFinger {
  return {
    onlineId: row.scoreId,
    legacyOnlineId: row.legacyScoreId,
    beatmapOnlineId: row.beatmapOnlineId,
    beatmapMd5: row.checksum,
    beatmapHash: row.beatmapHash,
    ruleset: row.ruleset,
    playedAtMs: row.endedAtMs,
    totalScore: row.totalScore,
    legacyTotalScore: row.legacyTotalScore,
  };
}

function findBeatmap(
  index: ReturnType<typeof buildTransferIndex>,
  byKey: Map<string, RealmObj>,
  row: ScoreTransferWriteRow,
): RealmObj | null {
  const finger = fingerFromRow(row);
  const kind = classifyTransferScore(finger, index);
  if (kind === "skipped" || kind === "already") return null;
  if (row.beatmapOnlineId > 0) {
    const maps = index.beatmapsByOnlineId.get(row.beatmapOnlineId) ?? [];
    const md5 = row.checksum?.trim().toLowerCase() ?? "";
    const hit =
      (md5 ? maps.find((map) => map.md5Hash?.trim().toLowerCase() === md5) : undefined) ??
      maps[0];
    if (!hit?.hash) return null;
    return byKey.get(`hash:${hit.hash.toLowerCase()}`) ?? null;
  }
  const md5 = row.checksum?.trim().toLowerCase() ?? "";
  if (md5) {
    const hit = index.beatmapsByMd5.get(md5);
    if (hit?.hash) return byKey.get(`hash:${hit.hash.toLowerCase()}`) ?? null;
  }
  const hash = row.beatmapHash?.trim().toLowerCase() ?? "";
  if (hash) return byKey.get(`hash:${hash}`) ?? null;
  return null;
}

export function runScoreTransferWrite(
  db: Db,
  dbPath: string,
  realmPath: string,
  payload: ScoreTransferWritePayload,
): ScoreTransferWriteResult {
  let realm: Realm | null = null;
  try {
    realm = openRealmForWrite(realmPath);
    const expected = loadOsuSchema().schemaVersion;
    if (realm.schemaVersion !== expected) {
      throw new SchemaVersionMismatchError(expected, realm.schemaVersion);
    }
    const backupPath = backupRealmFile(realmPath, dbPath);
    const realmScores = realm.objects<RealmObj>("Score");
    const realmMaps = realm.objects<RealmObj>("Beatmap");
    const fingers: TransferFinger[] = [];
    const onlineObjs = new Map<number, RealmObj>();
    const legacyObjs = new Map<number, RealmObj>();
    for (const obj of realmScores) {
      const finger = fingerFromRealm(obj);
      fingers.push(finger);
      if (finger.onlineId > 0 && !onlineObjs.has(finger.onlineId)) onlineObjs.set(finger.onlineId, obj);
      if (finger.legacyOnlineId > 0 && !legacyObjs.has(finger.legacyOnlineId)) {
        legacyObjs.set(finger.legacyOnlineId, obj);
      }
    }
    const mapRefs: TransferBeatmap[] = [];
    const byKey = new Map<string, RealmObj>();
    for (const obj of realmMaps) {
      const ref = beatmapRef(obj);
      if (!ref?.hash) continue;
      mapRefs.push(ref);
      byKey.set(`hash:${ref.hash.toLowerCase()}`, obj);
    }
    const index = buildTransferIndex(fingers, mapRefs);
    const rulesetCache = new Map<string, RealmObj>();
    const created: RealmObj[] = [];
    const mirrorAlso: RealmObj[] = [];
    let skipped = 0;

    realm.write(() => {
      for (const row of payload.rows) {
        const finger = fingerFromRow(row);
        const kind = classifyTransferScore(finger, index);
        if (kind === "already") {
          const existing =
            (row.scoreId > 0 ? onlineObjs.get(row.scoreId) : undefined) ??
            (row.legacyScoreId > 0 ? legacyObjs.get(row.legacyScoreId) : undefined);
          if (existing) mirrorAlso.push(existing);
          skipped += 1;
          continue;
        }
        const beatmap = findBeatmap(index, byKey, row);
        const beatmapHash = beatmap ? String(beatmap.Hash ?? "") : "";
        if (!beatmap || !beatmapHash) {
          skipped += 1;
          continue;
        }
        let ruleset = rulesetCache.get(row.ruleset);
        if (!ruleset) {
          ruleset = realm!.objectForPrimaryKey<RealmObj>("Ruleset", row.ruleset) ?? undefined;
          if (!ruleset) {
            skipped += 1;
            continue;
          }
          rulesetCache.set(row.ruleset, ruleset);
        }
        const id = new Realm.BSON.UUID();
        realm!.create("Score", {
          ID: id,
          BeatmapInfo: beatmap,
          ClientVersion: row.clientVersion || "",
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
          OnlineID: row.scoreId > 0 ? row.scoreId : -1,
          LegacyOnlineID: row.legacyScoreId > 0 ? row.legacyScoreId : -1,
          User: {
            OnlineID: row.userOnlineId,
            Username: row.username,
            CountryCode: "",
          },
          Mods: row.modsJson || "[]",
          Statistics: row.statisticsJson || "{}",
          MaximumStatistics: row.maximumStatisticsJson || "{}",
          Rank: row.rank,
          Combo: row.combo,
          IsLegacyScore: row.isLegacy,
          Pauses: [],
        });
        if (row.scoreId > 0) index.onlineIds.add(row.scoreId);
        if (row.legacyScoreId > 0) index.legacyIds.add(row.legacyScoreId);
        const bucket = Math.floor(row.endedAtMs / FINGERPRINT_MS);
        const key = `${row.ruleset}\0${bucket}`;
        const list = index.buckets.get(key);
        if (list) list.push(finger);
        else index.buckets.set(key, [finger]);
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
    if (scoreIds.length > 0) {
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
            scoreIds.length > FULL_ANALYTICS_ID_THRESHOLD ? null : JSON.stringify(scoreIds),
          watermarkPlayedAt: last?.watermarkPlayedAt ?? null,
          watermarkLastLocalUpdate: last?.watermarkLastLocalUpdate ?? null,
        })
        .run();
    }

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
