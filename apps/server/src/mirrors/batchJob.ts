import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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
  collectMatchingOnlineBeatmapsets,
  searchOnlineBeatmapsets,
  type MirrorSearchResult,
} from "./searchOnline";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

export type MirrorBatchJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

/** Sub-step while status is running/stopping. */
export type MirrorBatchPhase = "idle" | "scanning" | "downloading";

export type MirrorBatchMode = "pages" | "query" | "ids";

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
  finishedAt: string | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
};

/** Shared download options. */
type BatchDownloadOpts = {
  noVideo?: boolean;
  excludeOwned?: boolean;
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

export type MirrorBatchIdsRequest = {
  mode: "ids";
  ids: number[];
  noVideo?: boolean;
};

export type MirrorBatchStartRequest =
  | MirrorBatchPagesRequest
  | MirrorBatchQueryRequest
  | MirrorBatchIdsRequest;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DELAY_BETWEEN_MS = 1_200;
const MAX_PAGE_COUNT = 10;
const MAX_RECENT_ERRORS = 8;
const MAX_QUERY_PAGES = 200;
const MAX_QUERY_SETS = 10_000;
const MAX_IDS = 2000;

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
  finishedAt: Date | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
  stopRequested: boolean;
  running: boolean;
};

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
  finishedAt: null,
  error: null,
  recentErrors: [],
  stopRequested: false,
  running: false,
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
  // Keep ready-to-open count honest if archives were imported/moved elsewhere.
  if (!job.running && job.savedPaths.length > 0) {
    const existing = job.savedPaths.filter((p) => existsSync(p));
    if (existing.length !== job.savedPaths.length) {
      job.savedPaths = existing;
      if (existing.length === 0) {
        job.importScriptSh = null;
        job.importScriptBat = null;
      }
    }
  }
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
    queued: job.queued,
    downloaded: job.downloaded,
    skippedExisting: job.skippedExisting,
    skippedOwned: job.skippedOwned,
    failed: job.failed,
    matched: job.matched,
    pagesScanned: job.pagesScanned,
    hitCap: job.hitCap,
    savedForImport: job.savedPaths.length,
    importScriptSh: job.importScriptSh,
    importScriptBat: job.importScriptBat,
    currentSetId: job.currentSetId,
    currentTitle: job.currentTitle,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    recentErrors: job.recentErrors,
  };
}

export function stopMirrorBatchJob(): MirrorBatchJobState {
  if (job.running) {
    job.stopRequested = true;
    job.status = "stopping";
  }
  return getMirrorBatchJobState();
}

function resetJob(
  partial: Partial<JobInternal> & { mode: MirrorBatchMode },
): void {
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
    finishedAt: null,
    error: null,
    recentErrors: [],
    stopRequested: false,
    running: true,
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
): Promise<{ sets: OnlineBeatmapSet[]; ownedSkipped: number }> {
  const sets: OnlineBeatmapSet[] = [];
  const seen = new Set<number>();
  let ownedSkipped = 0;
  const useQl = params.query != null;

  for (let i = 0; i < params.pageCount; i += 1) {
    if (job.stopRequested) break;
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
    job.pagesScanned += 1;
    ownedSkipped += result.ownedSkipped;
    for (const set of result.items) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      sets.push(set);
    }
    job.matched = sets.length;
    job.skippedOwned = ownedSkipped;
    if (!result.hasMore && result.mirrorCount === 0) break;
  }

  return { sets, ownedSkipped };
}

async function collectSetsQuery(
  db: Db,
  onlineQuery: OnlineMirrorQuery,
  opts: { excludeOwned: boolean; maxPages: number; maxSets: number },
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
    shouldStop: () => job.stopRequested,
    onPage: (info) => {
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

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 64) {
      throw new Error("Response too small to be an .osz");
    }

    writeFileSync(destPath, bytes);
    return { result: "downloaded", path: destPath };
  }

  throw new Error("HTTP 429 (rate limited after retries)");
}

async function downloadQueue(
  sets: Array<
    OnlineBeatmapSet | { id: number; artist?: string; title?: string }
  >,
  noVideo: boolean,
): Promise<void> {
  const downloadDir = ensureBeatmapsDownloadDir();
  job.downloadDir = downloadDir;
  mkdirSync(downloadDir, { recursive: true });
  job.phase = "downloading";
  job.queued = sets.length;
  job.savedPaths = [];
  const downloadedIds: number[] = [];

  for (const set of sets) {
    if (job.stopRequested) break;
    job.currentSetId = set.id;
    job.currentTitle =
      "artist" in set && set.artist && set.title
        ? `${set.artist} - ${set.title}`
        : `#${set.id}`;
    try {
      const { result, path: destPath } = await downloadSetToDisk(
        set,
        downloadDir,
        noVideo,
      );
      if (result === "exists") job.skippedExisting += 1;
      else job.downloaded += 1;
      job.savedPaths.push(destPath);
      downloadedIds.push(set.id);
    } catch (err) {
      job.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      job.recentErrors = [
        { setId: set.id, error: message },
        ...job.recentErrors,
      ].slice(0, MAX_RECENT_ERRORS);
    }
    await sleep(DELAY_BETWEEN_MS);
  }

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
  try {
    const mode: MirrorBatchMode = request.mode ?? "pages";
    let sets: Array<OnlineBeatmapSet | { id: number }> = [];

    if (mode === "ids" && request.mode === "ids") {
      const ids = [...new Set(request.ids)].filter(
        (id) => Number.isSafeInteger(id) && id > 0,
      );
      job.matched = ids.length;
      sets = ids.map((id) => ({ id }));
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
      });
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
      });
      job.skippedOwned = collected.ownedSkipped;
      job.matched = collected.sets.length;
      sets = collected.sets;
    }

    await downloadQueue(sets, job.noVideo);

    job.currentSetId = null;
    job.currentTitle = null;
    job.finishedAt = new Date();
    job.phase = "idle";
    job.status = "completed";
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.phase = "idle";
    job.status = "error";
    job.finishedAt = new Date();
  } finally {
    job.running = false;
    job.stopRequested = false;
  }
}

export function startMirrorBatchJob(
  db: Db,
  request: MirrorBatchStartRequest,
): MirrorBatchJobState {
  if (job.running) {
    throw new Error("A batch download is already running");
  }

  const mode: MirrorBatchMode = request.mode ?? "pages";

  if (mode === "ids" && request.mode === "ids") {
    const ids = [...new Set(request.ids)].filter(
      (id) => Number.isSafeInteger(id) && id > 0,
    );
    if (ids.length === 0) {
      throw new Error("ids must contain at least one positive beatmapset id");
    }
    if (ids.length > MAX_IDS) {
      throw new Error(`ids is capped at ${MAX_IDS}`);
    }
    resetJob({
      mode: "ids",
      query: null,
      noVideo: request.noVideo !== false,
      excludeOwned: false,
    });
    void runBatch(db, { mode: "ids", ids, noVideo: job.noVideo });
    return getMirrorBatchJobState();
  }

  if (mode === "query" && request.mode === "query") {
    parseOnlineMirrorQuery(request.query);
    resetJob({
      mode: "query",
      query: request.query.trim(),
      noVideo: request.noVideo !== false,
      excludeOwned: request.excludeOwned !== false,
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
  if (job.running) {
    throw new Error("A batch download is already running");
  }
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
}

/**
 * Drop gone paths from the in-memory import list; if none remain, rescan the
 * download folder for leftover `.osz` files (e.g. after osu! already imported).
 */
function refreshSavedPathsFromDisk(): string[] {
  const downloadDir = ensureBeatmapsDownloadDir();
  job.downloadDir = downloadDir;

  const stillTracked = job.savedPaths.filter((p) => existsSync(p));
  if (stillTracked.length > 0) {
    job.savedPaths = stillTracked;
    return stillTracked;
  }

  const onDisk = listOszArchivesInDir(downloadDir);
  job.savedPaths = onDisk;
  return onDisk;
}

/**
 * Open registered archives in osu!lazer (from the last batch and/or individual
 * saves). If tracked paths are gone (already imported/moved), rescans the
 * download folder and refreshes `savedForImport` instead of hard-failing.
 */
export async function openLastBatchArchivesInOsu(): Promise<
  OpenOszBatchResult & {
    importScriptSh: string | null;
    importScriptBat: string | null;
    savedForImport: number;
    message: string | null;
    rescanned: boolean;
  }
> {
  if (job.running) {
    throw new Error("Cannot open archives while a batch download is running");
  }

  const trackedBefore = job.savedPaths.length;
  const existingBefore = job.savedPaths.filter((p) => existsSync(p)).length;
  const paths = refreshSavedPathsFromDisk();
  const rescanned = trackedBefore > 0 && existingBefore === 0;

  if (paths.length === 0) {
    job.importScriptSh = null;
    job.importScriptBat = null;
    return {
      opened: 0,
      failed: 0,
      errors: [],
      platform: process.platform,
      importScriptSh: null,
      importScriptBat: null,
      savedForImport: 0,
      rescanned: true,
      message:
        trackedBefore > 0
          ? "No .osz archives left in the download folder — they were likely already opened or moved. Ready-to-open list cleared."
          : "No archives ready to open. Download a map or run a batch first.",
    };
  }

  const scripts = writeOsuImportScripts(job.downloadDir, paths);
  job.importScriptSh = scripts.sh;
  job.importScriptBat = scripts.bat;

  const result = await openOszFilesInOsu(paths);

  // osu! may consume/move archives; drop anything that disappeared.
  const stillThere = paths.filter((p) => existsSync(p));
  job.savedPaths = stillThere;
  if (stillThere.length > 0) {
    const nextScripts = writeOsuImportScripts(job.downloadDir, stillThere);
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
    savedForImport: stillThere.length,
    rescanned,
    message: rescanned
      ? `Tracked archives were gone; opened ${result.opened} leftover .osz from the download folder.`
      : null,
  };
}
