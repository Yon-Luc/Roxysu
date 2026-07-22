import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import {
  beatmapSetArchiveFilename,
  ensureBeatmapsDownloadDir,
  resolveBeatmapsDownloadDir,
} from "./downloadDir";
import { getActiveBeatmapMirrorProvider } from "./providers";
import {
  searchOnlineBeatmapsets,
  type MirrorSearchResult,
} from "./searchOnline";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";

export type MirrorBatchJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type MirrorBatchJobState = {
  status: MirrorBatchJobStatus;
  downloadDir: string;
  startPage: number;
  pageCount: number;
  noVideo: boolean;
  excludeOwned: boolean;
  queued: number;
  downloaded: number;
  skippedExisting: number;
  skippedOwned: number;
  failed: number;
  currentSetId: number | null;
  currentTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
};

type BatchRequest = MirrorSearchParams & {
  startPage: number;
  pageCount: number;
  noVideo?: boolean;
  excludeOwned?: boolean;
};

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DELAY_BETWEEN_MS = 1_200;
const MAX_PAGE_COUNT = 10;
const MAX_RECENT_ERRORS = 8;

let job: {
  status: MirrorBatchJobStatus;
  downloadDir: string;
  startPage: number;
  pageCount: number;
  noVideo: boolean;
  excludeOwned: boolean;
  queued: number;
  downloaded: number;
  skippedExisting: number;
  skippedOwned: number;
  failed: number;
  currentSetId: number | null;
  currentTitle: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  recentErrors: Array<{ setId: number; error: string }>;
  stopRequested: boolean;
  running: boolean;
} = {
  status: "idle",
  downloadDir: resolveBeatmapsDownloadDir(),
  startPage: 0,
  pageCount: 0,
  noVideo: true,
  excludeOwned: true,
  queued: 0,
  downloaded: 0,
  skippedExisting: 0,
  skippedOwned: 0,
  failed: 0,
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

export function getMirrorBatchJobState(): MirrorBatchJobState {
  return {
    status: job.status,
    downloadDir: job.downloadDir,
    startPage: job.startPage,
    pageCount: job.pageCount,
    noVideo: job.noVideo,
    excludeOwned: job.excludeOwned,
    queued: job.queued,
    downloaded: job.downloaded,
    skippedExisting: job.skippedExisting,
    skippedOwned: job.skippedOwned,
    failed: job.failed,
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

async function collectSets(
  db: Db,
  params: BatchRequest,
): Promise<{ sets: OnlineBeatmapSet[]; ownedSkipped: number }> {
  const sets: OnlineBeatmapSet[] = [];
  const seen = new Set<number>();
  let ownedSkipped = 0;

  for (let i = 0; i < params.pageCount; i += 1) {
    if (job.stopRequested) break;
    const page = params.startPage + i;
    const result: MirrorSearchResult = await searchOnlineBeatmapsets(db, {
      q: params.q,
      mode: params.mode,
      status: params.status,
      sort: params.sort,
      page,
      excludeOwned: params.excludeOwned,
    });
    ownedSkipped += result.ownedSkipped;
    for (const set of result.items) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      sets.push(set);
    }
    if (!result.hasMore && result.mirrorCount === 0) break;
  }

  return { sets, ownedSkipped };
}

async function downloadSetToDisk(
  set: OnlineBeatmapSet,
  destDir: string,
  noVideo: boolean,
): Promise<"downloaded" | "exists"> {
  const filename = beatmapSetArchiveFilename(set);
  const destPath = path.join(destDir, filename);
  if (existsSync(destPath)) return "exists";

  const provider = getActiveBeatmapMirrorProvider();
  const url = provider.buildDownloadUrl(set.id, { noVideo });
  const res = await fetch(url, {
    headers: { "user-agent": "roxysu", accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 64) {
    throw new Error("Response too small to be an .osz");
  }

  // Write via temp-ish unique name then rename would be nicer; keep simple for local use.
  writeFileSync(destPath, bytes);
  return "downloaded";
}

async function runBatch(db: Db, params: BatchRequest): Promise<void> {
  try {
    const downloadDir = ensureBeatmapsDownloadDir();
    job.downloadDir = downloadDir;
    mkdirSync(downloadDir, { recursive: true });

    const { sets, ownedSkipped } = await collectSets(db, params);
    job.skippedOwned = ownedSkipped;
    job.queued = sets.length;

    for (const set of sets) {
      if (job.stopRequested) break;
      job.currentSetId = set.id;
      job.currentTitle = `${set.artist} - ${set.title}`;
      try {
        const result = await downloadSetToDisk(set, downloadDir, params.noVideo === true);
        if (result === "exists") job.skippedExisting += 1;
        else job.downloaded += 1;
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

    job.currentSetId = null;
    job.currentTitle = null;
    job.finishedAt = new Date();
    job.status = "completed";
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.status = "error";
    job.finishedAt = new Date();
  } finally {
    job.running = false;
    job.stopRequested = false;
  }
}

export function startMirrorBatchJob(
  db: Db,
  params: BatchRequest,
): MirrorBatchJobState {
  if (job.running) {
    throw new Error("A batch download is already running");
  }

  const pageCount = Math.min(
    MAX_PAGE_COUNT,
    Math.max(1, Math.floor(params.pageCount)),
  );
  const startPage = Math.max(0, Math.floor(params.startPage));

  job = {
    status: "running",
    downloadDir: resolveBeatmapsDownloadDir(),
    startPage,
    pageCount,
    noVideo: params.noVideo !== false,
    excludeOwned: params.excludeOwned !== false,
    queued: 0,
    downloaded: 0,
    skippedExisting: 0,
    skippedOwned: 0,
    failed: 0,
    currentSetId: null,
    currentTitle: null,
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    recentErrors: [],
    stopRequested: false,
    running: true,
  };

  void runBatch(db, {
    ...params,
    startPage,
    pageCount,
    noVideo: job.noVideo,
    excludeOwned: job.excludeOwned,
  });

  return getMirrorBatchJobState();
}
