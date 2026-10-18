import { randomUUID } from "node:crypto";
import {
  beatmaps,
  bmsScoreDetails,
  bmsSyncQueue,
  scores,
} from "@roxysu/db/schema";
import {
  BMS_AUTO_UPLOAD_KEY,
  BMS_BACKFILL_STATUS_KEY,
  BMS_HISTORICAL_UPLOAD_KEY,
  BMS_HUB_JWT_KEY,
  BMS_INSTALLATION_ID_KEY,
  BMS_SYNC_AUTH_PAUSED_KEY,
} from "@roxysu/db/settings-keys";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@roxysu/db/types";
import { resolveHubBaseUrl } from "../hubUrl";
import { enqueueNewScores } from "./derive";
import { readSetting, writeSetting } from "./settings";

const PAGE = 200;
const BATCH = 40;

export type BmsQueueState =
  | "pending"
  | "uploading"
  | "retry_wait"
  | "synced"
  | "rejected";

export type BmsBatchResult = {
  localScoreId: string;
  status: "accepted" | "duplicate" | "rejected" | "retryable_error";
  scoreId?: string;
  reason?: string;
};

export function retryDelayMs(attempt: number, random = Math.random()): number {
  const exp = Math.min(10, Math.max(0, attempt));
  const base = Math.min(60 * 60_000, 5_000 * 2 ** exp);
  return base + Math.floor(random * base * 0.2);
}

export function nextQueueState(
  result: BmsBatchResult,
  attempts: number,
  now: number,
): {
  state: BmsQueueState;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  hubScoreId: string | null;
} {
  if (result.status === "accepted" || result.status === "duplicate") {
    return {
      state: "synced",
      attempts,
      nextAttemptAt: null,
      lastError: null,
      hubScoreId: result.scoreId ?? null,
    };
  }
  if (result.status === "rejected") {
    return {
      state: "rejected",
      attempts,
      nextAttemptAt: null,
      lastError: result.reason ?? "rejected",
      hubScoreId: null,
    };
  }
  const nextAttempts = attempts + 1;
  return {
    state: "retry_wait",
    attempts: nextAttempts,
    nextAttemptAt: new Date(now + retryDelayMs(nextAttempts)),
    lastError: result.reason ?? "retryable_error",
    hubScoreId: null,
  };
}

export async function ensureInstallationId(db: Db): Promise<string> {
  const existing = await readSetting(db, BMS_INSTALLATION_ID_KEY);
  if (existing) return existing;
  const id = randomUUID();
  await writeSetting(db, BMS_INSTALLATION_ID_KEY, id);
  return id;
}

export async function recoverStuckUploads(db: Db): Promise<void> {
  await db
    .update(bmsSyncQueue)
    .set({ state: "pending", updatedAt: new Date() })
    .where(eq(bmsSyncQueue.state, "uploading"));
}

/** Queue eligible scores that have no queue row yet. Does not rewrite existing rows. */
export async function enqueueHistoricalPage(db: Db): Promise<number> {
  const missing = await db
    .select({ scoreId: bmsScoreDetails.scoreId })
    .from(bmsScoreDetails)
    .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
    .leftJoin(bmsSyncQueue, eq(bmsSyncQueue.scoreId, bmsScoreDetails.scoreId))
    .where(
      and(
        eq(bmsScoreDetails.autoplay, false),
        eq(scores.deletePending, false),
        isNull(bmsSyncQueue.scoreId),
      ),
    )
    .orderBy(asc(bmsScoreDetails.scoreId))
    .limit(PAGE);
  if (missing.length === 0) {
    await writeSetting(db, BMS_BACKFILL_STATUS_KEY, "done");
    return 0;
  }
  await writeSetting(db, BMS_BACKFILL_STATUS_KEY, "running");
  return enqueueNewScores(
    db,
    missing.map((row) => row.scoreId),
  );
}

type QueuePayload = {
  localScoreId: string;
  rulesetId: "bms";
  chart: {
    md5: string;
    sha256: string | null;
    title: string | null;
    artist: string | null;
    keyCount: number | null;
  };
  achievedAt: string;
  score: {
    exScore: number | null;
    maxExScore: number | null;
    normalizedScore: number;
    accuracy: number;
  };
  judgements: {
    pgreat: number | null;
    great: number | null;
    good: number | null;
    bad: number | null;
    poor: number | null;
    miss: number | null;
    ePoor: null;
  };
  gameplay: {
    variantId: string;
    gaugeId: string | null;
    comboLampId: string | null;
    clearLampId: null;
    djGrade: string | null;
    mods: string[];
  };
};

async function loadReady(db: Db, now: Date, limit: number) {
  return db
    .select({
      scoreId: bmsSyncQueue.scoreId,
      attempts: bmsSyncQueue.attempts,
      exScore: bmsScoreDetails.exScore,
      maxExScore: bmsScoreDetails.maxExScore,
      normalizedScore: bmsScoreDetails.normalizedScore,
      accuracy: bmsScoreDetails.accuracy,
      pgreat: bmsScoreDetails.pgreat,
      great: bmsScoreDetails.great,
      good: bmsScoreDetails.good,
      bad: bmsScoreDetails.bad,
      poor: bmsScoreDetails.poor,
      miss: bmsScoreDetails.miss,
      variantId: bmsScoreDetails.variantId,
      gaugeId: bmsScoreDetails.gaugeId,
      comboLampId: bmsScoreDetails.comboLampId,
      djGrade: bmsScoreDetails.djGrade,
      modAcronyms: bmsScoreDetails.modAcronyms,
      playedAt: scores.playedAt,
      md5: beatmaps.md5Hash,
      sha256: beatmaps.hash,
      title: beatmaps.title,
      artist: beatmaps.artist,
      keyCount: beatmaps.circleSize,
    })
    .from(bmsSyncQueue)
    .innerJoin(bmsScoreDetails, eq(bmsScoreDetails.scoreId, bmsSyncQueue.scoreId))
    .innerJoin(scores, eq(scores.id, bmsSyncQueue.scoreId))
    .leftJoin(beatmaps, eq(beatmaps.id, scores.beatmapId))
    .where(
      and(
        eq(scores.deletePending, false),
        eq(bmsScoreDetails.autoplay, false),
        or(
          eq(bmsSyncQueue.state, "pending"),
          and(
            eq(bmsSyncQueue.state, "retry_wait"),
            or(
              isNull(bmsSyncQueue.nextAttemptAt),
              lte(bmsSyncQueue.nextAttemptAt, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(bmsSyncQueue.scoreId))
    .limit(limit);
}

function toPayload(row: Awaited<ReturnType<typeof loadReady>>[number]): QueuePayload | null {
  const md5 = row.md5?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{32}$/.test(md5)) return null;
  const sha = row.sha256?.toLowerCase() ?? "";
  let mods: string[] = [];
  try {
    const parsed = JSON.parse(row.modAcronyms) as unknown;
    if (Array.isArray(parsed)) {
      mods = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    mods = [];
  }
  const played = row.playedAt instanceof Date ? row.playedAt : new Date(row.playedAt);
  return {
    localScoreId: row.scoreId,
    rulesetId: "bms",
    chart: {
      md5,
      sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null,
      title: row.title,
      artist: row.artist,
      keyCount: row.keyCount == null ? null : Math.round(row.keyCount),
    },
    achievedAt: played.toISOString(),
    score: {
      exScore: row.exScore,
      maxExScore: row.maxExScore,
      normalizedScore: row.normalizedScore,
      accuracy: row.accuracy,
    },
    judgements: {
      pgreat: row.pgreat,
      great: row.great,
      good: row.good,
      bad: row.bad,
      poor: row.poor,
      miss: row.miss,
      ePoor: null,
    },
    gameplay: {
      variantId: row.variantId,
      gaugeId: row.gaugeId,
      comboLampId: row.comboLampId,
      clearLampId: null,
      djGrade: row.djGrade,
      mods,
    },
  };
}

async function markState(
  db: Db,
  scoreId: string,
  patch: {
    state: BmsQueueState;
    attempts: number;
    nextAttemptAt: Date | null;
    lastError: string | null;
    hubScoreId: string | null;
  },
): Promise<void> {
  await db
    .update(bmsSyncQueue)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bmsSyncQueue.scoreId, scoreId));
}

export async function drainBmsQueue(
  db: Db,
  options: {
    post: (body: {
      installationId: string;
      scores: QueuePayload[];
    }) => Promise<
      | { ok: true; results: BmsBatchResult[] }
      | { ok: false; status: number; message: string }
    >;
    now?: number;
    limit?: number;
    force?: boolean;
  },
): Promise<{ uploaded: number; authPaused: boolean }> {
  const uploadsOn = (await readSetting(db, BMS_AUTO_UPLOAD_KEY)) === "1";
  const historicalOn = (await readSetting(db, BMS_HISTORICAL_UPLOAD_KEY)) === "1";
  if (!options.force && !uploadsOn && !historicalOn) {
    return { uploaded: 0, authPaused: false };
  }
  if ((await readSetting(db, BMS_SYNC_AUTH_PAUSED_KEY)) === "1" && !options.force) {
    return { uploaded: 0, authPaused: true };
  }
  const token = await readSetting(db, BMS_HUB_JWT_KEY);
  if (!token) return { uploaded: 0, authPaused: false };

  const now = options.now ?? Date.now();
  const rows = await loadReady(db, new Date(now), options.limit ?? BATCH);
  if (rows.length === 0) return { uploaded: 0, authPaused: false };

  const ready: Array<{ row: (typeof rows)[number]; payload: QueuePayload }> = [];
  for (const row of rows) {
    const payload = toPayload(row);
    if (!payload) {
      await markState(db, row.scoreId, {
        state: "rejected",
        attempts: row.attempts,
        nextAttemptAt: null,
        lastError: "missing chart md5",
        hubScoreId: null,
      });
      continue;
    }
    ready.push({ row, payload });
    await db
      .update(bmsSyncQueue)
      .set({ state: "uploading", updatedAt: new Date() })
      .where(eq(bmsSyncQueue.scoreId, row.scoreId));
  }
  if (ready.length === 0) return { uploaded: 0, authPaused: false };

  const installationId = await ensureInstallationId(db);
  let response: Awaited<ReturnType<typeof options.post>>;
  try {
    response = await options.post({
      installationId,
      scores: ready.map((item) => item.payload),
    });
  } catch (err) {
    response = {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "upload failed",
    };
  }

  if (!response.ok && response.status === 401) {
    await writeSetting(db, BMS_SYNC_AUTH_PAUSED_KEY, "1");
    for (const item of ready) {
      await markState(db, item.row.scoreId, {
        state: "retry_wait",
        attempts: item.row.attempts,
        nextAttemptAt: null,
        lastError: "hub login expired",
        hubScoreId: null,
      });
    }
    return { uploaded: 0, authPaused: true };
  }

  const byId = new Map<string, BmsBatchResult>();
  if (response.ok) {
    for (const result of response.results) byId.set(result.localScoreId, result);
  }

  let uploaded = 0;
  for (const item of ready) {
    const result = response.ok
      ? byId.get(item.row.scoreId) ?? {
          localScoreId: item.row.scoreId,
          status: "retryable_error" as const,
          reason: "missing result",
        }
      : {
          localScoreId: item.row.scoreId,
          status: "retryable_error" as const,
          reason: response.message,
        };
    const patch = nextQueueState(result, item.row.attempts, now);
    await markState(db, item.row.scoreId, patch);
    if (patch.state === "synced") uploaded += 1;
  }
  return { uploaded, authPaused: false };
}

export async function bmsSyncStatus(db: Db) {
  const counts = await db
    .select({
      state: bmsSyncQueue.state,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsSyncQueue)
    .groupBy(bmsSyncQueue.state);
  const byState: Record<string, number> = {};
  for (const row of counts) byState[row.state] = row.n;
  return {
    autoUpload: (await readSetting(db, BMS_AUTO_UPLOAD_KEY)) === "1",
    historicalUpload: (await readSetting(db, BMS_HISTORICAL_UPLOAD_KEY)) === "1",
    backfill: (await readSetting(db, BMS_BACKFILL_STATUS_KEY)) ?? "idle",
    authPaused: (await readSetting(db, BMS_SYNC_AUTH_PAUSED_KEY)) === "1",
    loggedIn: (await readSetting(db, BMS_HUB_JWT_KEY)) != null,
    counts: {
      pending: byState.pending ?? 0,
      uploading: byState.uploading ?? 0,
      retryWait: byState.retry_wait ?? 0,
      synced: byState.synced ?? 0,
      rejected: byState.rejected ?? 0,
    },
  };
}

export async function postBmsBatch(
  body: { installationId: string; scores: QueuePayload[] },
  token: string,
): Promise<
  | { ok: true; results: BmsBatchResult[] }
  | { ok: false; status: number; message: string }
> {
  const res = await fetch(`${resolveHubBaseUrl()}/api/bms/scores/batch`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    results?: BmsBatchResult[];
    message?: string;
  };
  if (!res.ok) {
    return { ok: false, status: res.status, message: data.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, results: data.results ?? [] };
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export async function tickBmsSync(db: Db): Promise<void> {
  if ((await readSetting(db, BMS_HISTORICAL_UPLOAD_KEY)) === "1") {
    const status = await readSetting(db, BMS_BACKFILL_STATUS_KEY);
    if (status !== "done") await enqueueHistoricalPage(db);
  }
  const token = await readSetting(db, BMS_HUB_JWT_KEY);
  if (!token) return;
  await drainBmsQueue(db, {
    post: (body) => postBmsBatch(body, token),
  });
}

export function startBmsSync(db: Db): () => void {
  void recoverStuckUploads(db);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void tickBmsSync(db)
      .catch((err) => console.error("[bms] sync tick failed", err))
      .finally(() => {
        ticking = false;
      });
  }, 15_000);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export async function retryWaiting(db: Db): Promise<number> {
  const rows = await db
    .select({ scoreId: bmsSyncQueue.scoreId })
    .from(bmsSyncQueue)
    .where(eq(bmsSyncQueue.state, "retry_wait"));
  if (rows.length === 0) return 0;
  await db
    .update(bmsSyncQueue)
    .set({
      state: "pending",
      nextAttemptAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(bmsSyncQueue.state, "retry_wait"));
  return rows.length;
}
