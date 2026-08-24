import {
  mkdirSync,
  existsSync,
  createWriteStream,
  unlinkSync,
  renameSync,
  statSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import type { Db } from "../db-runtime";
import {
  beatmapSetArchiveFilename,
  ensureBeatmapsDownloadDir,
  listOszArchivesInDir,
  resolveBeatmapsDownloadDir,
} from "./downloadDir";
import { parseOnlineMirrorQuery, type OnlineMirrorQuery } from "./onlineQuery";
import {
  openOszFilesInOsu,
  writeOsuImportScripts,
  type OpenOszBatchResult,
} from "./openInOsu";
import { recordPendingDownloads } from "./pendingDownloads";
import { getActiveBeatmapMirrorProvider } from "./providers";
import {
  filterNotSentToOsu,
  recordSentToOsu,
} from "./sentToOsu";
import {
  collectMatchingOnlineBeatmapsets,
  searchOnlineBeatmapsets,
  type MirrorSearchResult,
} from "./searchOnline";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";
import { diffAgainstLibrary } from "./ownership";

export type MirrorBatchJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

/** Sub-step while status is running/stopping. */
export type MirrorBatchPhase = "idle" | "scanning" | "downloading";

export type MirrorBatchMode = "pages" | "query" | "setIds";

export type MirrorBatchJobState = {
  status: MirrorBatchJobStatus;
  phase: MirrorBatchPhase;
  mode: MirrorBatchMode;
  downloadDir: string;
  query: string | null;
  startPage: number;
  pageCount: number;
  noVideo: boolean;
  excludeOwned: boolean;
  downloadConcurrency: number;
  queued: number;
  downloaded: number;
  skippedExisting: number;
  skippedOwned: number;
  failed: number;
  matched: number;
  pagesScanned: number;
  hitCap: boolean;
  /** Archives from the last batch that can be opened in osu! (new + already on disk). */
  savedForImport: number;
  importScriptSh: string | null;
  importScriptBat: string | null;
  currentSetId: number | null;
  currentTitle: string | null;
  startedAt: string | null;
  downloadingStartedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
};

/** Shared download options. */
type BatchDownloadOpts = {
  noVideo?: boolean;
  excludeOwned?: boolean;
  /** Number of maps to download in parallel (1–DOWNLOAD_CONCURRENCY_MAX). Default: DOWNLOAD_CONCURRENCY_DEFAULT. */
  downloadConcurrency?: number;
};

export type MirrorBatchPagesRequest = BatchDownloadOpts & {
  mode?: "pages";
  /** App QL — preferred when set. */
  query?: string;
  /** Legacy free-text mirror `q` when not using QL. */
  q?: string;
  ruleset?: MirrorSearchParams["mode"];
  status?: MirrorSearchParams["status"];
  sort?: MirrorSearchParams["sort"];
  startPage: number;
  pageCount: number;
};

export type MirrorBatchQueryRequest = BatchDownloadOpts & {
  mode: "query";
  query: string;
  sort?: MirrorSearchParams["sort"];
  maxPages?: number;
  maxSets?: number;
};

export type MirrorBatchSetIdsRequest = BatchDownloadOpts & {
  mode: "setIds";
  setIds: number[];
};

export type MirrorBatchStartRequest =
  | MirrorBatchPagesRequest
  | MirrorBatchQueryRequest
  | MirrorBatchSetIdsRequest;

const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Minimum pause between finishing one download slot and starting the next. */
const DELAY_BETWEEN_MS = 200;
const MAX_PAGE_COUNT = 10;
const MAX_RECENT_ERRORS = 8;
const MAX_QUERY_PAGES = 1000;
const MAX_QUERY_SETS = 100_000;
/** Default number of simultaneous downloads. */
export const DOWNLOAD_CONCURRENCY_DEFAULT = 3;
/** Upper cap the user can raise to via the UI. */
export const DOWNLOAD_CONCURRENCY_MAX = 10;

type JobInternal = {
  status: MirrorBatchJobStatus;
  phase: MirrorBatchPhase;
  mode: MirrorBatchMode;
  downloadDir: string;
  query: string | null;
  startPage: number;
  pageCount: number;
  noVideo: boolean;
  excludeOwned: boolean;
  downloadConcurrency: number;
  queued: number;
  downloaded: number;
  skippedExisting: number;
  skippedOwned: number;
  failed: number;
  matched: number;
  pagesScanned: number;
  hitCap: boolean;
  savedPaths: string[];
  importScriptSh: string | null;
  importScriptBat: string | null;
  currentSetId: number | null;
  currentTitle: string | null;
  startedAt: Date | null;
  downloadingStartedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
  stopRequested: boolean;
  running: boolean;
  /** Bumped to abandon in-flight work after force-unlock / new start. */
  generation: number;
};

let openingInProgress = false;
let savingInProgress = false;
let didIdleReconcile = false;
/** Monotonic id so abandoned async batches stop mutating `job`. */
let jobGeneration = 0;

/**
 * Clear in-memory download locks left behind by a hung batch or Open-in-osu!
 * call. Safe on process start (nothing can still be running in *this* process).
 * Also used as a force-unlock when Stop is pressed while already stopping.
 *
 * Preserves idle import bookkeeping (savedPaths / scripts) so leftover .osz
 * files remain openable after unlock.
 *
 * @returns true when a lock was actually held
 */
export function clearStuckMirrorBatchLocks(): boolean {
  const wasLocked =
    job.running ||
    openingInProgress ||
    savingInProgress ||
    job.status === "running" ||
    job.status === "stopping";
  openingInProgress = false;
  savingInProgress = false;
  // Abandon any in-flight runBatch / download slots still awaiting I/O.
  jobGeneration += 1;
  job.generation = jobGeneration;
  if (!wasLocked) return false;

  job.running = false;
  job.stopRequested = true;
  job.phase = "idle";
  job.currentSetId = null;
  job.currentTitle = null;
  if (job.status === "running" || job.status === "stopping") {
    job.status = "error";
    job.error =
      job.error ??
      "Download lock was cleared (stuck batch / process restart). You can start a new batch.";
    job.finishedAt = new Date();
  }
  return true;
}

/** Reset in-memory batch state (tests / process-start equivalent). */
export function resetMirrorBatchJobForTests(): void {
  didIdleReconcile = false;
  savingInProgress = false;
  clearStuckMirrorBatchLocks();
  job = {
    status: "idle",
    phase: "idle",
    mode: "pages",
    downloadDir: resolveBeatmapsDownloadDir(),
    query: null,
    startPage: 0,
    pageCount: 0,
    noVideo: true,
    excludeOwned: true,
    downloadConcurrency: DOWNLOAD_CONCURRENCY_DEFAULT,
    queued: 0,
    downloaded: 0,
    skippedExisting: 0,
    skippedOwned: 0,
    failed: 0,
    matched: 0,
    pagesScanned: 0,
    hitCap: false,
    savedPaths: [],
    importScriptSh: null,
    importScriptBat: null,
    currentSetId: null,
    currentTitle: null,
    startedAt: null,
    downloadingStartedAt: null,
    finishedAt: null,
    error: null,
    recentErrors: [],
    stopRequested: false,
    running: false,
    generation: jobGeneration,
  };
}

/** Test-only: leave the job looking like a hung batch (no async worker). */
export function simulateStuckMirrorBatchForTests(
  status: "running" | "stopping" = "stopping",
): void {
  job.running = true;
  job.stopRequested = status === "stopping";
  job.status = status;
  job.phase = "downloading";
  job.startedAt = new Date();
  job.downloadingStartedAt = job.startedAt;
  job.finishedAt = null;
  job.error = null;
}

function pathsReadyToOpen(downloadDir: string = job.downloadDir): string[] {
  return filterNotSentToOsu(
    job.savedPaths.filter((p) => existsSync(p)),
    downloadDir,
  );
}

/**
 * After a process restart the in-memory import list is empty even though
 * `.osz` files may still be in the download folder. Re-discover unsent
 * leftovers so "Open in osu!" stays available across Roxysu restarts.
 */
function reconcileIdleSavedPaths(): void {
  const downloadDir = resolveBeatmapsDownloadDir();
  job.downloadDir = downloadDir;

  const existing = job.savedPaths.filter((p) => existsSync(p));
  if (existing.length !== job.savedPaths.length) {
    job.savedPaths = existing;
  }

  if (job.savedPaths.length > 0) {
    if (!job.importScriptSh && !job.importScriptBat) {
      const scripts = writeOsuImportScripts(downloadDir, job.savedPaths);
      job.importScriptSh = scripts.sh;
      job.importScriptBat = scripts.bat;
    }
    return;
  }

  const leftovers = filterNotSentToOsu(
    listOszArchivesInDir(downloadDir),
    downloadDir,
  );
  if (leftovers.length === 0) {
    job.importScriptSh = null;
    job.importScriptBat = null;
    return;
  }

  job.savedPaths = leftovers;
  const scripts = writeOsuImportScripts(downloadDir, leftovers);
  job.importScriptSh = scripts.sh;
  job.importScriptBat = scripts.bat;
}

let job: JobInternal = {
  status: "idle",
  phase: "idle",
  mode: "pages",
  downloadDir: resolveBeatmapsDownloadDir(),
  query: null,
  startPage: 0,
  pageCount: 0,
  noVideo: true,
  excludeOwned: true,
  downloadConcurrency: DOWNLOAD_CONCURRENCY_DEFAULT,
  queued: 0,
  downloaded: 0,
  skippedExisting: 0,
  skippedOwned: 0,
  failed: 0,
  matched: 0,
  pagesScanned: 0,
  hitCap: false,
  savedPaths: [],
  importScriptSh: null,
  importScriptBat: null,
  currentSetId: null,
  currentTitle: null,
  startedAt: null,
  downloadingStartedAt: null,
  finishedAt: null,
  error: null,
  recentErrors: [],
  stopRequested: false,
  running: false,
  generation: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const asInt = Number(raw);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, (asDate - Date.now()) / 1000);
  }
  return null;
}

export function getMirrorBatchJobState(): MirrorBatchJobState {
  if (!job.running) {
    if (!didIdleReconcile) {
      reconcileIdleSavedPaths();
      didIdleReconcile = true;
    } else if (job.savedPaths.length > 0) {
      job.savedPaths = job.savedPaths.filter((p) => existsSync(p));
    }
  }
  const ready = job.running
    ? filterNotSentToOsu(job.savedPaths, job.downloadDir)
    : pathsReadyToOpen();
  return {
    status: job.status,
    phase: job.phase,
    mode: job.mode,
    downloadDir: job.downloadDir,
    query: job.query,
    startPage: job.startPage,
    pageCount: job.pageCount,
    noVideo: job.noVideo,
    excludeOwned: job.excludeOwned,
    downloadConcurrency: job.downloadConcurrency,
    queued: job.queued,
    downloaded: job.downloaded,
    skippedExisting: job.skippedExisting,
    skippedOwned: job.skippedOwned,
    failed: job.failed,
    matched: job.matched,
    pagesScanned: job.pagesScanned,
    hitCap: job.hitCap,
    savedForImport: ready.length,
    importScriptSh: job.importScriptSh,
    importScriptBat: job.importScriptBat,
    currentSetId: job.currentSetId,
    currentTitle: job.currentTitle,
    startedAt: job.startedAt?.toISOString() ?? null,
    downloadingStartedAt: job.downloadingStartedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    recentErrors: job.recentErrors,
  };
}

export function stopMirrorBatchJob(): MirrorBatchJobState {
  // Second Stop while already stopping / hung: force-clear the lock so the UI
  // cannot stay stuck forever if a download slot ignored cancellation.
  if (job.status === "stopping" || (job.running === false && job.status === "running")) {
    clearStuckMirrorBatchLocks();
    return getMirrorBatchJobState();
  }
  if (job.running) {
    job.stopRequested = true;
    job.status = "stopping";
  }
  return getMirrorBatchJobState();
}

function resetJob(
  partial: Partial<JobInternal> & { mode: MirrorBatchMode },
): void {
  jobGeneration += 1;
  job = {
    status: "running",
    phase: "scanning",
    mode: partial.mode,
    downloadDir: resolveBeatmapsDownloadDir(),
    query: partial.query ?? null,
    startPage: partial.startPage ?? 0,
    pageCount: partial.pageCount ?? 0,
    noVideo: partial.noVideo !== false,
    excludeOwned: partial.excludeOwned !== false,
    downloadConcurrency: Math.min(
      DOWNLOAD_CONCURRENCY_MAX,
      Math.max(1, Math.floor(partial.downloadConcurrency ?? DOWNLOAD_CONCURRENCY_DEFAULT)),
    ),
    queued: 0,
    downloaded: 0,
    skippedExisting: 0,
    skippedOwned: 0,
    failed: 0,
    matched: 0,
    pagesScanned: 0,
    hitCap: false,
    savedPaths: [],
    importScriptSh: null,
    importScriptBat: null,
    currentSetId: null,
    currentTitle: null,
    startedAt: new Date(),
    downloadingStartedAt: null,
    finishedAt: null,
    error: null,
    recentErrors: [],
    stopRequested: false,
    running: true,
    generation: jobGeneration,
  };
}

function archivePathForSet(
  set: OnlineBeatmapSet | { id: number; artist?: string; title?: string },
  destDir: string,
): string {
  const filename =
    "artist" in set && set.artist && set.title
      ? beatmapSetArchiveFilename(set as OnlineBeatmapSet)
      : `${set.id}.osz`;
  return path.join(destDir, filename);
}

async function collectSetsPages(
  db: Db,
  params: MirrorBatchPagesRequest,
  generation: number,
): Promise<{ sets: OnlineBeatmapSet[]; ownedSkipped: number }> {
  const sets: OnlineBeatmapSet[] = [];
  const seen = new Set<number>();
  let ownedSkipped = 0;
  const useQl = params.query != null;

  for (let i = 0; i < params.pageCount; i += 1) {
    if (job.stopRequested || generation !== job.generation) break;
    const page = params.startPage + i;
    const result: MirrorSearchResult = await searchOnlineBeatmapsets(db, {
      ...(useQl
        ? { query: params.query }
        : {
            q: params.q,
            mode: params.ruleset,
            status: params.status,
          }),
      sort: params.sort,
      page,
      excludeOwned: params.excludeOwned,
    });
    if (generation !== job.generation) break;
    job.pagesScanned += 1;
    ownedSkipped += result.ownedSkipped;
    for (const set of result.items) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      sets.push(set);
    }
    job.matched = sets.length;
    job.skippedOwned = ownedSkipped;
    if (!result.hasMore) break;
  }

  return { sets, ownedSkipped };
}

async function collectSetsQuery(
  db: Db,
  onlineQuery: OnlineMirrorQuery,
  opts: { excludeOwned: boolean; maxPages: number; maxSets: number },
  generation: number,
): Promise<{
  sets: OnlineBeatmapSet[];
  ownedSkipped: number;
  hitCap: boolean;
}> {
  const result = await collectMatchingOnlineBeatmapsets(db, {
    onlineQuery,
    excludeOwned: opts.excludeOwned,
    maxPages: opts.maxPages,
    maxSets: opts.maxSets,
    shouldStop: () =>
      job.stopRequested || generation !== job.generation,
    onPage: (info) => {
      if (generation !== job.generation) return;
      job.pagesScanned = info.mirrorPage + 1;
      job.matched = info.matchedSoFar;
      job.skippedOwned = info.ownedSkipped;
    },
  });
  return {
    sets: result.sets,
    ownedSkipped: result.ownedSkipped,
    hitCap: result.hitPageCap || result.hitSetCap,
  };
}

async function downloadSetToDisk(
  set: OnlineBeatmapSet | { id: number; artist?: string; title?: string },
  destDir: string,
  noVideo: boolean,
): Promise<{ result: "downloaded" | "exists"; path: string }> {
  const destPath = archivePathForSet(set, destDir);
  if (existsSync(destPath)) return { result: "exists", path: destPath };

  const provider = getActiveBeatmapMirrorProvider();
  const url = provider.buildDownloadUrl(set.id, { noVideo });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      headers: { "user-agent": MIRROR_USER_AGENT, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (res.status === 429) {
      const waitSec = parseRetryAfterSeconds(res) ?? 5;
      await sleep(Math.min(60, Math.max(1, waitSec)) * 1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error("Empty response body");
    }

    const tmpPath = `${destPath}.part`;
    try {
      await pipeline(
        Readable.fromWeb(
          res.body as unknown as import("stream/web").ReadableStream,
        ),
        createWriteStream(tmpPath),
      );
      const size = statSync(tmpPath).size;
      if (size < 64) {
        unlinkSync(tmpPath);
        throw new Error("Response too small to be an .osz");
      }
      renameSync(tmpPath, destPath);
    } catch (err) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore leftover part file
      }
      throw err;
    }
    return { result: "downloaded", path: destPath };
  }

  throw new Error("HTTP 429 (rate limited after retries)");
}

async function downloadQueue(
  sets: Array<
    OnlineBeatmapSet | { id: number; artist?: string; title?: string }
  >,
  noVideo: boolean,
  concurrency: number,
  generation: number,
): Promise<void> {
  const downloadDir = ensureBeatmapsDownloadDir();
  if (generation !== job.generation) return;
  job.downloadDir = downloadDir;
  mkdirSync(downloadDir, { recursive: true });
  job.phase = "downloading";
  job.downloadingStartedAt = new Date();
  job.queued = sets.length;
  job.savedPaths = [];
  const downloadedIds: number[] = [];

  let index = 0;

  async function runSlot(): Promise<void> {
    while (index < sets.length) {
      if (job.stopRequested || generation !== job.generation) break;
      const set = sets[index++];
      if (generation === job.generation) {
        job.currentSetId = set.id;
        job.currentTitle =
          "artist" in set && set.artist && set.title
            ? `${set.artist} - ${set.title}`
            : `#${set.id}`;
      }
      try {
        const { result, path: destPath } = await downloadSetToDisk(
          set,
          downloadDir,
          noVideo,
        );
        if (generation !== job.generation) break;
        if (result === "exists") job.skippedExisting += 1;
        else job.downloaded += 1;
        job.savedPaths.push(destPath);
        downloadedIds.push(set.id);
      } catch (err) {
        if (generation !== job.generation) break;
        job.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        job.recentErrors = [
          { setId: set.id, error: message },
          ...job.recentErrors,
        ].slice(0, MAX_RECENT_ERRORS);
      }
      // Small courtesy pause between downloads per slot — much shorter than
      // before since multiple slots now run in parallel.
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  // Launch `concurrency` slots that each pull from the shared queue.
  await Promise.all(
    Array.from({ length: concurrency }, () => runSlot()),
  );

  if (generation !== job.generation) return;

  if (downloadedIds.length > 0) {
    recordPendingDownloads(downloadedIds, downloadDir);
  }

  if (job.savedPaths.length > 0) {
    const scripts = writeOsuImportScripts(downloadDir, job.savedPaths);
    job.importScriptSh = scripts.sh;
    job.importScriptBat = scripts.bat;
  }
}

async function runBatch(
  db: Db,
  request: MirrorBatchStartRequest,
): Promise<void> {
  const generation = job.generation;
  try {
    const mode: MirrorBatchMode = request.mode ?? "pages";
    let sets: Array<OnlineBeatmapSet | { id: number }> = [];

    if (mode === "setIds" && request.mode === "setIds") {
      job.phase = "scanning";
      const unique = [
        ...new Set(
          request.setIds.filter((id) => Number.isSafeInteger(id) && id > 0),
        ),
      ];
      if (job.excludeOwned) {
        const diff = await diffAgainstLibrary(db, unique);
        if (generation !== job.generation) return;
        job.skippedOwned = diff.owned.length;
        sets = diff.missing.map((id) => ({ id }));
      } else {
        sets = unique.map((id) => ({ id }));
      }
      job.matched = sets.length;
    } else if (mode === "query" && request.mode === "query") {
      const onlineQuery = parseOnlineMirrorQuery(request.query, {
        defaultSort: request.sort ?? "ranked_desc",
      });
      const collected = await collectSetsQuery(db, onlineQuery, {
        excludeOwned: job.excludeOwned,
        maxPages: Math.min(
          MAX_QUERY_PAGES,
          Math.max(1, request.maxPages ?? MAX_QUERY_PAGES),
        ),
        maxSets: Math.min(
          MAX_QUERY_SETS,
          Math.max(1, request.maxSets ?? MAX_QUERY_SETS),
        ),
      }, generation);
      if (generation !== job.generation) return;
      job.skippedOwned = collected.ownedSkipped;
      job.matched = collected.sets.length;
      job.hitCap = collected.hitCap;
      sets = collected.sets;
    } else {
      const pagesReq = request as MirrorBatchPagesRequest;
      const pageCount = Math.min(
        MAX_PAGE_COUNT,
        Math.max(1, Math.floor(pagesReq.pageCount)),
      );
      const startPage = Math.max(0, Math.floor(pagesReq.startPage));
      const collected = await collectSetsPages(db, {
        ...pagesReq,
        mode: "pages",
        startPage,
        pageCount,
        excludeOwned: job.excludeOwned,
      }, generation);
      if (generation !== job.generation) return;
      job.skippedOwned = collected.ownedSkipped;
      job.matched = collected.sets.length;
      sets = collected.sets;
    }

    await downloadQueue(sets, job.noVideo, job.downloadConcurrency, generation);
    if (generation !== job.generation) return;

    job.currentSetId = null;
    job.currentTitle = null;
    job.finishedAt = new Date();
    job.phase = "idle";
    job.status = "completed";
  } catch (err) {
    if (generation !== job.generation) return;
    job.error = err instanceof Error ? err.message : String(err);
    job.phase = "idle";
    job.status = "error";
    job.finishedAt = new Date();
  } finally {
    if (generation === job.generation) {
      job.running = false;
      job.stopRequested = false;
      didIdleReconcile = false;
    }
  }
}

export function startMirrorBatchJob(
  db: Db,
  request: MirrorBatchStartRequest,
): MirrorBatchJobState {
  if (job.running || savingInProgress) {
    throw new Error("A batch download is already running");
  }

  const mode: MirrorBatchMode = request.mode ?? "pages";

  if (mode === "setIds" && request.mode === "setIds") {
    if (!Array.isArray(request.setIds) || request.setIds.length === 0) {
      throw new Error("setIds is required for mode=setIds");
    }
    resetJob({
      mode: "setIds",
      query: `setIds:${request.setIds.length}`,
      noVideo: request.noVideo !== false,
      excludeOwned: request.excludeOwned !== false,
      downloadConcurrency: request.downloadConcurrency,
    });
    void runBatch(db, {
      mode: "setIds",
      setIds: request.setIds,
      noVideo: job.noVideo,
      excludeOwned: job.excludeOwned,
      downloadConcurrency: job.downloadConcurrency,
    });
    return getMirrorBatchJobState();
  }

  if (mode === "query" && request.mode === "query") {
    parseOnlineMirrorQuery(request.query);
    resetJob({
      mode: "query",
      query: request.query.trim(),
      noVideo: request.noVideo !== false,
      excludeOwned: request.excludeOwned !== false,
      downloadConcurrency: request.downloadConcurrency,
    });
    void runBatch(db, {
      mode: "query",
      query: request.query,
      sort: request.sort,
      noVideo: job.noVideo,
      excludeOwned: job.excludeOwned,
      maxPages: request.maxPages,
      maxSets: request.maxSets,
    });
    return getMirrorBatchJobState();
  }

  const pagesReq = request as MirrorBatchPagesRequest;
  const pageCount = Math.min(
    MAX_PAGE_COUNT,
    Math.max(1, Math.floor(pagesReq.pageCount)),
  );
  const startPage = Math.max(0, Math.floor(pagesReq.startPage));

  if (pagesReq.query != null) {
    parseOnlineMirrorQuery(pagesReq.query);
  }

  resetJob({
    mode: "pages",
    query: pagesReq.query?.trim() ?? pagesReq.q?.trim() ?? null,
    startPage,
    pageCount,
    noVideo: pagesReq.noVideo !== false,
    excludeOwned: pagesReq.excludeOwned !== false,
    downloadConcurrency: pagesReq.downloadConcurrency,
  });

  void runBatch(db, {
    ...pagesReq,
    mode: "pages",
    startPage,
    pageCount,
    noVideo: job.noVideo,
    excludeOwned: job.excludeOwned,
  });

  return getMirrorBatchJobState();
}

/**
 * Save one beatmapset `.osz` into the shared download folder and register it
 * for "Open in osu!". Safe to call while idle (not mid-batch).
 */
export async function saveBeatmapsetArchive(opts: {
  setId: number;
  artist?: string;
  title?: string;
  noVideo?: boolean;
}): Promise<
  MirrorBatchJobState & {
    setId: number;
    result: "downloaded" | "exists";
    path: string;
  }
> {
  if (job.running || savingInProgress) {
    throw new Error("A batch download is already running");
  }
  savingInProgress = true;
  try {
  const setId = opts.setId;
  if (!Number.isSafeInteger(setId) || setId <= 0) {
    throw new Error("Invalid beatmapset id");
  }

  const downloadDir = ensureBeatmapsDownloadDir();
  job.downloadDir = downloadDir;
  mkdirSync(downloadDir, { recursive: true });

  const set = {
    id: setId,
    artist: opts.artist,
    title: opts.title,
  };
  const { result, path: destPath } = await downloadSetToDisk(
    set,
    downloadDir,
    opts.noVideo !== false,
  );

  if (!job.savedPaths.includes(destPath)) {
    job.savedPaths.push(destPath);
  }
  recordPendingDownloads([setId], downloadDir);
  const scripts = writeOsuImportScripts(downloadDir, job.savedPaths);
  job.importScriptSh = scripts.sh;
  job.importScriptBat = scripts.bat;

  return {
    ...getMirrorBatchJobState(),
    setId,
    result,
    path: destPath,
  };
  } finally {
    savingInProgress = false;
  }
}

/**
 * Drop gone paths from the in-memory import list; if none remain, rescan the
 * download folder for leftover `.osz` files (e.g. after osu! already imported).
 */

/**
 * Open registered archives in osu!lazer (from the last batch and/or individual
 * saves). Each archive is only sent once — osu! may keep the .osz on disk while
 * import tasks run, so we persist a sent list to avoid duplicate queues.
 */
export async function openLastBatchArchivesInOsu(): Promise<
  OpenOszBatchResult & {
    importScriptSh: string | null;
    importScriptBat: string | null;
    savedForImport: number;
    skippedAlreadySent: number;
    message: string | null;
    rescanned: boolean;
  }
> {
  if (job.running) {
    throw new Error("Cannot open archives while a batch download is running");
  }
  if (openingInProgress) {
    throw new Error(
      "Already opening archives in osu! — wait for the current batch to finish.",
    );
  }

  openingInProgress = true;
  // Safety net: never leave the open-lock stuck if the OS open path hangs.
  const openLockWatchdog = setTimeout(() => {
    if (openingInProgress) {
      openingInProgress = false;
    }
  }, 10 * 60_000);
  try {
    const trackedBefore = job.savedPaths.length;
    const existingBefore = job.savedPaths.filter((p) => existsSync(p)).length;
    // Pick up leftover .osz after a Roxysu restart (in-memory list is empty).
    reconcileIdleSavedPaths();
    const downloadDir = ensureBeatmapsDownloadDir();
    job.downloadDir = downloadDir;

    const stillTracked = job.savedPaths.filter((p) => existsSync(p));
    const candidates =
      stillTracked.length > 0 ? stillTracked : listOszArchivesInDir(downloadDir);
    const skippedAlreadySent =
      candidates.length -
      filterNotSentToOsu(candidates, downloadDir).length;
    const paths = filterNotSentToOsu(candidates, downloadDir);
    const rescanned = trackedBefore > 0 && existingBefore === 0;

    if (paths.length === 0) {
      job.savedPaths = [];
      job.importScriptSh = null;
      job.importScriptBat = null;
      return {
        opened: 0,
        failed: 0,
        openedPaths: [],
        errors: [],
        platform: process.platform,
        importScriptSh: null,
        importScriptBat: null,
        savedForImport: 0,
        skippedAlreadySent,
        rescanned,
        message:
          skippedAlreadySent > 0
            ? `${skippedAlreadySent} archive(s) were already sent to osu! — wait for import tasks to finish (osu! counts tasks per difficulty, not per set).`
            : trackedBefore > 0
              ? "No .osz archives left in the download folder — they were likely already opened or moved."
              : "No archives ready to open. Download a map or run a batch first.",
      };
    }

    job.savedPaths = paths;
    const scripts = writeOsuImportScripts(job.downloadDir, paths);
    job.importScriptSh = scripts.sh;
    job.importScriptBat = scripts.bat;

    const result = await openOszFilesInOsu(paths);

    if (result.openedPaths.length > 0) {
      recordSentToOsu(result.openedPaths, job.downloadDir);
    }

    const failedSet = new Set(result.errors.map((e) => path.resolve(e.path)));
    job.savedPaths = paths.filter((p) => failedSet.has(path.resolve(p)));
    if (job.savedPaths.length > 0) {
      const nextScripts = writeOsuImportScripts(job.downloadDir, job.savedPaths);
      job.importScriptSh = nextScripts.sh;
      job.importScriptBat = nextScripts.bat;
    } else {
      job.importScriptSh = null;
      job.importScriptBat = null;
    }

    return {
      ...result,
      importScriptSh: job.importScriptSh,
      importScriptBat: job.importScriptBat,
      savedForImport: job.savedPaths.length,
      skippedAlreadySent,
      rescanned,
      message: rescanned
        ? `Tracked archives were gone; opened ${result.opened} leftover .osz from the download folder.`
        : skippedAlreadySent > 0
          ? `Skipped ${skippedAlreadySent} already sent. Opened ${result.opened} new archive(s) in osu!.`
          : null,
    };
  } finally {
    clearTimeout(openLockWatchdog);
    openingInProgress = false;
  }
}
