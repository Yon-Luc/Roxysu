import { and, eq, sql } from "drizzle-orm";
import {
  osuApiPark,
  osuApiUsage,
  osuBestScores,
  osuScorePulls,
} from "@roxysu/db/hub";
import { db } from "../db";
import {
  acquireOsuSlot,
  markOsuParked,
  OsuPullTimeoutError,
  osuBudgetSnapshot,
  releaseOsuSlot,
  seedOsuBudget,
  type OsuBudgetSnapshot,
} from "./osuBudget";
import {
  OSU_API_VERSION,
  RANKED_BEST_PAGE,
  SCORE_PULL_FRESH_MS,
  normalizeRankedBest,
  type RankedBest,
  type ScoreRuleset,
} from "./osuScoreShape";
import { createKeyedFlights } from "./singleFlight";

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const API = "https://osu.ppy.sh/api/v2";

/** One outbound osu! HTTP call, including the client-credentials token fetch. */
export const OSU_HTTP_TIMEOUT_MS = 15_000;
/** Whole ranked-best pull, including 429 sleeps and the page walk. */
export const OSU_PULL_DEADLINE_MS = 180_000;
/** A 429 cannot park the shared budget longer than this. */
export const OSU_RETRY_AFTER_CAP_SEC = 60;
/** Stop a walk that never sees a short page. 80 × 100 scores. */
export const OSU_MAX_PAGES = 80;

export { OsuPullTimeoutError };

export function retryAfterMs(header: string | null): number {
  const sec = Number(header ?? "60");
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 60;
  return Math.min(safe, OSU_RETRY_AFTER_CAP_SEC) * 1000;
}

/** Next ranked-best offsets, never more than the pages still allowed. */
export function rankedBestPageOffsets(
  offset: number,
  pagesFetched: number,
  maxPages = OSU_MAX_PAGES,
): number[] {
  const room = maxPages - pagesFetched;
  if (room <= 0) return [];
  const stride = Math.min(4, room);
  return Array.from({ length: stride }, (_, i) => offset + i * RANKED_BEST_PAGE);
}

function throwIfPullAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new OsuPullTimeoutError();
}

function outboundSignal(parent: AbortSignal): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(OSU_HTTP_TIMEOUT_MS)]);
}

function rethrowFetchAbort(err: unknown, parent: AbortSignal): never {
  if (parent.aborted || (err instanceof Error && err.name === "AbortError")) {
    throw new OsuPullTimeoutError();
  }
  throw err;
}

type Token = { access: string; expiresAt: number };
let token: Token | null = null;
let budgetReady: Promise<void> | null = null;

export type PullBudget = OsuBudgetSnapshot & {
  cacheHitsThisMinute: number;
  parked: boolean;
};

async function ensureBudgetSeeded(): Promise<void> {
  if (budgetReady) return budgetReady;
  budgetReady = (async () => {
    const minute = Math.floor(Date.now() / 60_000);
    const usage = await db
      .select({ calls: osuApiUsage.calls })
      .from(osuApiUsage)
      .where(eq(osuApiUsage.minuteBucket, minute))
      .get();
    const park = await db
      .select({ parkedUntil: osuApiPark.parkedUntil })
      .from(osuApiPark)
      .where(eq(osuApiPark.id, 1))
      .get();
    seedOsuBudget(usage?.calls ?? 0, park?.parkedUntil ?? null);
  })();
  return budgetReady;
}

async function clientToken(signal: AbortSignal): Promise<string> {
  throwIfPullAborted(signal);
  const now = Date.now();
  if (token && token.expiresAt > now + 60_000) return token.access;
  const clientId = process.env.OSU_CLIENT_ID;
  const clientSecret = process.env.OSU_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("osu! API credentials are not configured on the Hub");
  }
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "public",
      }),
      signal: outboundSignal(signal),
    });
  } catch (err) {
    rethrowFetchAbort(err, signal);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`osu! token failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = {
    access: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return token.access;
}

function minuteBucket(now = Date.now()): number {
  return Math.floor(now / 60_000);
}

async function recordCall(status: number, remaining: number | null): Promise<void> {
  const bucket = minuteBucket();
  const ok = status >= 200 && status < 300 ? 1 : 0;
  const notFound = status === 404 ? 1 : 0;
  const limited = status === 429 ? 1 : 0;
  const other = ok + notFound + limited === 0 ? 1 : 0;
  await db
    .insert(osuApiUsage)
    .values({
      minuteBucket: bucket,
      calls: 1,
      cacheHits: 0,
      ok,
      notFound,
      limited,
      other,
      lowestRemaining: remaining,
    })
    .onConflictDoUpdate({
      target: osuApiUsage.minuteBucket,
      set: {
        calls: sql`${osuApiUsage.calls} + 1`,
        ok: sql`${osuApiUsage.ok} + ${ok}`,
        notFound: sql`${osuApiUsage.notFound} + ${notFound}`,
        limited: sql`${osuApiUsage.limited} + ${limited}`,
        other: sql`${osuApiUsage.other} + ${other}`,
        lowestRemaining:
          remaining == null
            ? osuApiUsage.lowestRemaining
            : sql`CASE WHEN ${osuApiUsage.lowestRemaining} IS NULL OR ${remaining} < ${osuApiUsage.lowestRemaining} THEN ${remaining} ELSE ${osuApiUsage.lowestRemaining} END`,
      },
    });
}

async function recordCacheHit(): Promise<void> {
  const bucket = minuteBucket();
  await db
    .insert(osuApiUsage)
    .values({
      minuteBucket: bucket,
      calls: 0,
      cacheHits: 1,
      ok: 0,
      notFound: 0,
      limited: 0,
      other: 0,
    })
    .onConflictDoUpdate({
      target: osuApiUsage.minuteBucket,
      set: { cacheHits: sql`${osuApiUsage.cacheHits} + 1` },
    });
}

function readRemaining(res: Response): number | null {
  const raw =
    res.headers.get("x-ratelimit-remaining") ??
    res.headers.get("X-RateLimit-Remaining");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function osuGet(path: string, signal: AbortSignal): Promise<Response> {
  throwIfPullAborted(signal);
  await ensureBudgetSeeded();
  await acquireOsuSlot(Date.now, signal);
  try {
    const access = await clientToken(signal);
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: "application/json",
          "x-api-version": OSU_API_VERSION,
          "User-Agent": "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)",
        },
        signal: outboundSignal(signal),
      });
    } catch (err) {
      rethrowFetchAbort(err, signal);
    }
    const remaining = readRemaining(res);
    await recordCall(res.status, remaining);
    if (res.status === 429) {
      const until = Date.now() + retryAfterMs(res.headers.get("retry-after"));
      markOsuParked(until);
      await db
        .insert(osuApiPark)
        .values({ id: 1, parkedUntil: until })
        .onConflictDoUpdate({
          target: osuApiPark.id,
          set: { parkedUntil: until },
        });
    }
    return res;
  } finally {
    releaseOsuSlot();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new OsuPullTimeoutError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OsuPullTimeoutError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchBestPage(
  osuUserId: number,
  ruleset: ScoreRuleset,
  offset: number,
  signal: AbortSignal,
): Promise<RankedBest[]> {
  const path = `/users/${osuUserId}/scores/best?mode=${ruleset}&limit=${RANKED_BEST_PAGE}&offset=${offset}&legacy_only=0`;
  let res = await osuGet(path, signal);
  for (let attempt = 0; res.status === 429 && attempt < 6; attempt++) {
    throwIfPullAborted(signal);
    await sleep(retryAfterMs(res.headers.get("retry-after")), signal);
    res = await osuGet(path, signal);
  }
  if (res.status === 429) {
    throw new Error("osu! rate limit");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`osu! best scores failed: ${res.status} ${text.slice(0, 180)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => normalizeRankedBest(row))
    .filter((row): row is RankedBest => row != null);
}

async function setProgress(
  osuUserId: number,
  ruleset: ScoreRuleset,
  patch: {
    status: "idle" | "running" | "done" | "error";
    pagesFetched?: number;
    scoreCount?: number;
    topScoreId?: number | null;
    message?: string | null;
    complete?: boolean;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(osuScorePulls)
    .values({
      osuUserId,
      ruleset,
      status: patch.status,
      pagesFetched: patch.pagesFetched ?? 0,
      scoreCount: patch.scoreCount ?? 0,
      topScoreId: patch.topScoreId ?? null,
      message: patch.message ?? null,
      completeAt: patch.complete ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [osuScorePulls.osuUserId, osuScorePulls.ruleset],
      set: {
        status: patch.status,
        pagesFetched: patch.pagesFetched ?? osuScorePulls.pagesFetched,
        scoreCount: patch.scoreCount ?? osuScorePulls.scoreCount,
        topScoreId: patch.topScoreId === undefined ? osuScorePulls.topScoreId : patch.topScoreId,
        message: patch.message === undefined ? osuScorePulls.message : patch.message,
        completeAt: patch.complete ? now : osuScorePulls.completeAt,
        updatedAt: now,
      },
    });
}

async function loadStored(osuUserId: number, ruleset: ScoreRuleset): Promise<RankedBest[]> {
  const rows = await db
    .select({ payloadJson: osuBestScores.payloadJson })
    .from(osuBestScores)
    .where(
      and(eq(osuBestScores.osuUserId, osuUserId), eq(osuBestScores.ruleset, ruleset)),
    );
  const out: RankedBest[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.payloadJson) as RankedBest);
    } catch {
      // skip a corrupt row
    }
  }
  out.sort((a, b) => (b.pp ?? 0) - (a.pp ?? 0));
  return out;
}

async function replaceStored(
  osuUserId: number,
  ruleset: ScoreRuleset,
  scores: RankedBest[],
): Promise<void> {
  const now = new Date();
  const chunk = 80;
  await db.transaction(async (tx) => {
    await tx
      .delete(osuBestScores)
      .where(
        and(eq(osuBestScores.osuUserId, osuUserId), eq(osuBestScores.ruleset, ruleset)),
      );
    for (let i = 0; i < scores.length; i += chunk) {
      const slice = scores.slice(i, i + chunk);
      if (slice.length === 0) continue;
      await tx.insert(osuBestScores).values(
        slice.map((score) => ({
          osuUserId,
          ruleset,
          scoreId: score.id,
          payloadJson: JSON.stringify(score),
          fetchedAt: now,
        })),
      );
    }
  });
}

async function walkPages(
  osuUserId: number,
  ruleset: ScoreRuleset,
  firstPage: RankedBest[] | null,
  signal: AbortSignal,
): Promise<RankedBest[]> {
  const all: RankedBest[] = [];
  const seen = new Set<number>();
  const push = (page: RankedBest[]) => {
    for (const score of page) {
      if (seen.has(score.id)) continue;
      seen.add(score.id);
      all.push(score);
    }
  };
  let offset = 0;
  let pages = 0;
  if (firstPage) {
    push(firstPage);
    pages = 1;
    if (firstPage.length < RANKED_BEST_PAGE) {
      await setProgress(osuUserId, ruleset, {
        status: "running",
        pagesFetched: pages,
        scoreCount: all.length,
      });
      return all;
    }
    offset = RANKED_BEST_PAGE;
  }

  for (;;) {
    throwIfPullAborted(signal);
    const offsets = rankedBestPageOffsets(offset, pages);
    if (offsets.length === 0) {
      throw new Error("osu! score pull exceeded the page cap");
    }
    const pagesBatch = await Promise.all(
      offsets.map((pageOffset) => fetchBestPage(osuUserId, ruleset, pageOffset, signal)),
    );
    let stop = false;
    for (const page of pagesBatch) {
      pages += 1;
      push(page);
      if (page.length < RANKED_BEST_PAGE) {
        stop = true;
        break;
      }
    }
    await setProgress(osuUserId, ruleset, {
      status: "running",
      pagesFetched: pages,
      scoreCount: all.length,
    });
    if (stop) break;
    offset += offsets.length * RANKED_BEST_PAGE;
  }
  return all;
}

type PullResult = { scores: RankedBest[]; fromCache: boolean; budget: PullBudget };

/** In-flight key: one ranked-best crawl per player and ruleset. */
export function pullKey(osuUserId: number, ruleset: ScoreRuleset): string {
  return `${osuUserId}:${ruleset}`;
}

const pullFlights = createKeyedFlights<string, PullResult>();

/**
 * Pull ranked bests for one player and ruleset. Overlapping callers for the
 * same `osuUserId:ruleset` (including a force refresh that arrives mid-pull)
 * share one crawl and one `replaceStored`; the entry is removed in finally.
 */
export function pullRankedBests(
  osuUserId: number,
  ruleset: ScoreRuleset,
  force = false,
): Promise<PullResult> {
  return pullFlights.run(pullKey(osuUserId, ruleset), () =>
    runPullRankedBests(osuUserId, ruleset, force),
  );
}

async function runPullRankedBests(
  osuUserId: number,
  ruleset: ScoreRuleset,
  force: boolean,
): Promise<PullResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSU_PULL_DEADLINE_MS);
  try {
    return await runPullBody(osuUserId, ruleset, force, controller.signal);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setProgress(osuUserId, ruleset, { status: "error", message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function runPullBody(
  osuUserId: number,
  ruleset: ScoreRuleset,
  force: boolean,
  signal: AbortSignal,
): Promise<PullResult> {
  throwIfPullAborted(signal);
  await ensureBudgetSeeded();
  const existing = await db
    .select()
    .from(osuScorePulls)
    .where(
      and(eq(osuScorePulls.osuUserId, osuUserId), eq(osuScorePulls.ruleset, ruleset)),
    )
    .get();

  const fresh =
    !force &&
    existing?.completeAt != null &&
    Date.now() - new Date(existing.completeAt).getTime() < SCORE_PULL_FRESH_MS;

  if (fresh) {
    const page0 = await fetchBestPage(osuUserId, ruleset, 0, signal);
    const top = page0[0]?.id ?? null;
    if (top === (existing?.topScoreId ?? null)) {
      await recordCacheHit();
      const scores = await loadStored(osuUserId, ruleset);
      return { scores, fromCache: true, budget: await budgetView() };
    }
    await setProgress(osuUserId, ruleset, { status: "running", pagesFetched: 1, scoreCount: page0.length });
    const scores = await walkPages(osuUserId, ruleset, page0, signal);
    await replaceStored(osuUserId, ruleset, scores);
    await setProgress(osuUserId, ruleset, {
      status: "done",
      pagesFetched: Math.max(1, Math.ceil(scores.length / RANKED_BEST_PAGE)),
      scoreCount: scores.length,
      topScoreId: scores[0]?.id ?? null,
      complete: true,
      message: null,
    });
    return { scores, fromCache: false, budget: await budgetView() };
  }

  await setProgress(osuUserId, ruleset, { status: "running", pagesFetched: 0, scoreCount: 0, message: null });
  const scores = await walkPages(osuUserId, ruleset, null, signal);
  await replaceStored(osuUserId, ruleset, scores);
  await setProgress(osuUserId, ruleset, {
    status: "done",
    scoreCount: scores.length,
    topScoreId: scores[0]?.id ?? null,
    pagesFetched: Math.max(1, Math.ceil(scores.length / RANKED_BEST_PAGE)),
    complete: true,
    message: null,
  });
  return { scores, fromCache: false, budget: await budgetView() };
}

export async function readPullProgress(osuUserId: number, ruleset: ScoreRuleset) {
  const row = await db
    .select()
    .from(osuScorePulls)
    .where(
      and(eq(osuScorePulls.osuUserId, osuUserId), eq(osuScorePulls.ruleset, ruleset)),
    )
    .get();
  return {
    status: row?.status ?? "idle",
    pagesFetched: row?.pagesFetched ?? 0,
    scoreCount: row?.scoreCount ?? 0,
    message: row?.message ?? null,
    budget: await budgetView(),
  };
}

export async function budgetView(): Promise<PullBudget> {
  await ensureBudgetSeeded();
  const snap = osuBudgetSnapshot();
  const usage = await db
    .select({ cacheHits: osuApiUsage.cacheHits })
    .from(osuApiUsage)
    .where(eq(osuApiUsage.minuteBucket, minuteBucket()))
    .get();
  return {
    ...snap,
    cacheHitsThisMinute: usage?.cacheHits ?? 0,
    parked: snap.parkedUntil != null,
  };
}

export async function budgetHistory(days = 2) {
  const since = minuteBucket() - days * 24 * 60;
  const rows = await db
    .select()
    .from(osuApiUsage)
    .where(sql`${osuApiUsage.minuteBucket} >= ${since}`);
  const todayStart = minuteBucket(new Date().setUTCHours(0, 0, 0, 0));
  let todayCalls = 0;
  let yesterdayCalls = 0;
  let todayLimited = 0;
  for (const row of rows) {
    if (row.minuteBucket >= todayStart) {
      todayCalls += row.calls;
      todayLimited += row.limited;
    } else if (row.minuteBucket >= todayStart - 24 * 60) {
      yesterdayCalls += row.calls;
    }
  }
  return {
    current: await budgetView(),
    todayCalls,
    yesterdayCalls,
    todayLimited,
  };
}
