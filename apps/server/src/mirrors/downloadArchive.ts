import {
  createWriteStream,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import {
  BEATMAP_MIRROR_PROVIDERS,
  getActiveBeatmapMirrorProvider,
  type BeatmapMirrorProvider,
  type BeatmapMirrorProviderId,
} from "./providers";
import { MIRROR_USER_AGENT } from "./userAgent";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const MIN_OSZ_BYTES = 64;
/**
 * Retries on 429 only (rate limit). 503 means this mirror cannot serve the set
 * right now — fall through to the next provider immediately (pending sets often
 * 503 on hinai while osu.direct still has the archive).
 */
const RATE_LIMIT_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const asInt = Number(raw);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return null;
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

/**
 * Active provider first, then the rest. Pending / graveyard sets often 503 on
 * hinai's proxy while osu.direct still has the archive.
 */
export function listDownloadProvidersInOrder(
  activeId: BeatmapMirrorProviderId = getActiveBeatmapMirrorProvider().id,
): BeatmapMirrorProvider[] {
  const active = BEATMAP_MIRROR_PROVIDERS[activeId];
  const rest = (
    Object.keys(BEATMAP_MIRROR_PROVIDERS) as BeatmapMirrorProviderId[]
  )
    .filter((id) => id !== activeId)
    .map((id) => BEATMAP_MIRROR_PROVIDERS[id]);
  return [active, ...rest];
}

async function streamUrlToFile(
  url: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(url, {
    headers: { "user-agent": MIRROR_USER_AGENT, accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (res.status === 429) {
    const waitSec = parseRetryAfterSeconds(res) ?? 5;
    const err = new Error(`HTTP ${res.status}`);
    (err as Error & { retryAfterSec?: number }).retryAfterSec = Math.min(
      60,
      Math.max(0, waitSec),
    );
    (err as Error & { rateLimited?: boolean }).rateLimited = true;
    throw err;
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
    if (size < MIN_OSZ_BYTES) {
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
}

async function tryProvider(
  provider: BeatmapMirrorProvider,
  setId: number,
  destPath: string,
  noVideo: boolean,
): Promise<void> {
  const url = provider.buildDownloadUrl(setId, { noVideo });
  let lastError: unknown;
  for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPTS; attempt += 1) {
    try {
      await streamUrlToFile(url, destPath);
      return;
    } catch (err) {
      lastError = err;
      const rateLimited =
        err instanceof Error &&
        (err as Error & { rateLimited?: boolean }).rateLimited === true;
      if (!rateLimited) throw err;
      const waitSec =
        (err as Error & { retryAfterSec?: number }).retryAfterSec ?? 5;
      await sleep(waitSec * 1000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

/** Thrown when every configured mirror failed to produce an `.osz`. */
export class MirrorArchiveUnavailableError extends Error {
  readonly code = "mirror_unavailable" as const;
  readonly setId: number;
  /** Technical per-provider failures (logs / debugging — not for the UI). */
  readonly providerErrors: string[];

  constructor(setId: number, providerErrors: string[]) {
    super(`Map #${setId} is not available for download right now.`);
    this.name = "MirrorArchiveUnavailableError";
    this.setId = setId;
    this.providerErrors = providerErrors;
  }
}

export function isMirrorArchiveUnavailableError(
  err: unknown,
): err is MirrorArchiveUnavailableError {
  return err instanceof MirrorArchiveUnavailableError;
}

/**
 * Download a beatmapset `.osz` into `destPath`, trying the active mirror then
 * falling back to the other configured providers (needed for pending sets that
 * hinai cannot proxy).
 */
export async function downloadBeatmapsetArchiveToPath(
  setId: number,
  destPath: string,
  noVideo: boolean,
): Promise<"downloaded" | "exists"> {
  if (existsSync(destPath)) return "exists";

  const providers = listDownloadProvidersInOrder();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      await tryProvider(provider, setId, destPath, noVideo);
      return "downloaded";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${message}`);
    }
  }

  throw new MirrorArchiveUnavailableError(setId, errors);
}
