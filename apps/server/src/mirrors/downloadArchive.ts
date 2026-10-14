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

/** Wait for response headers / first byte before falling through to next mirror. */
export const DOWNLOAD_FIRST_BYTE_MS = 20_000;
/** Max time to stream the archive body after headers arrive. */
export const DOWNLOAD_BODY_TIMEOUT_MS = 120_000;
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

export function isDownloadAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function combineSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => s != null);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
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
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const userSignal = opts?.signal;
  if (userSignal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const headerSignal = combineSignals(
    userSignal,
    AbortSignal.timeout(DOWNLOAD_FIRST_BYTE_MS),
  );

  const res = await fetch(url, {
    headers: { "user-agent": MIRROR_USER_AGENT, accept: "*/*" },
    redirect: "follow",
    signal: headerSignal,
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

  const bodySignal = combineSignals(
    userSignal,
    AbortSignal.timeout(DOWNLOAD_BODY_TIMEOUT_MS),
  );

  const tmpPath = `${destPath}.part`;
  const write = createWriteStream(tmpPath);
  const onAbort = () => {
    write.destroy(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  };
  bodySignal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (bodySignal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    await pipeline(
      Readable.fromWeb(
        res.body as unknown as import("stream/web").ReadableStream,
      ),
      write,
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
  } finally {
    bodySignal?.removeEventListener("abort", onAbort);
  }
}

async function tryProvider(
  provider: BeatmapMirrorProvider,
  setId: number,
  destPath: string,
  noVideo: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const url = provider.buildDownloadUrl(setId, { noVideo });
  let lastError: unknown;
  for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    try {
      await streamUrlToFile(url, destPath, { signal });
      return;
    } catch (err) {
      lastError = err;
      if (isDownloadAbortError(err) && signal?.aborted) throw err;
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
  opts?: { signal?: AbortSignal },
): Promise<"downloaded" | "exists"> {
  if (existsSync(destPath)) return "exists";

  const providers = listDownloadProvidersInOrder();
  const errors: string[] = [];
  const signal = opts?.signal;

  for (const provider of providers) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    try {
      await tryProvider(provider, setId, destPath, noVideo, signal);
      return "downloaded";
    } catch (err) {
      if (isDownloadAbortError(err) && signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.id}: ${message}`);
    }
  }

  throw new MirrorArchiveUnavailableError(setId, errors);
}
