import { readFile, stat } from "node:fs/promises";
import { decodeLegacyReplay, type DecodedReplay } from "./decode";

/**
 * Runtime helpers for `GET /scores/:id/replay`: bounded in-memory results for
 * decoded replays and judgments, plus a concurrency limiter so a slow replay
 * cannot starve other requests. Decode and judging stay on this process (no
 * worker thread); the limiter and `yieldToEventLoop` bound how long they hold it.
 */

/** LRU keyed by string, bounded by entry count and by an estimated byte total. */
export class BoundedLru<V> {
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /** Stores `value`; an entry larger than the whole byte budget is not kept. */
  set(key: string, value: V, bytes: number): void {
    const prev = this.map.get(key);
    if (prev) {
      this.totalBytes -= prev.bytes;
      this.map.delete(key);
    }
    if (bytes > this.maxBytes) return;
    this.map.set(key, { value, bytes });
    this.totalBytes += bytes;
    while (
      this.map.size > this.maxEntries ||
      this.totalBytes > this.maxBytes
    ) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const evicted = this.map.get(oldest.value)!;
      this.totalBytes -= evicted.bytes;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }
}

/** FIFO limiter: at most `max` tasks run at once, the rest wait. */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    // A woken waiter inherits the slot of the task that released it.
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const FRAME_BYTES_ESTIMATE = 48;
const JUDGMENT_BYTES_ESTIMATE = 200;

export const REPLAY_HEAVY_CONCURRENCY = 2;
export const replayLimiter = new ConcurrencyLimiter(REPLAY_HEAVY_CONCURRENCY);

/** Decoded frames (the bulk of memory). 16 entries / 96 MiB estimated. */
export const decodedReplayCache = new BoundedLru<DecodedReplay>(
  16,
  96 * 1024 * 1024,
);

export type CachedJudging<J, S> = { judgments: J[]; summary: S };

/** Judgments and summaries only. 64 entries / 32 MiB estimated. */
export const judgingCache = new BoundedLru<CachedJudging<unknown, unknown>>(
  64,
  32 * 1024 * 1024,
);

function estimateDecodedBytes(d: DecodedReplay): number {
  return (
    (d.frames.length +
      d.stdFrames.length +
      d.taikoFrames.length +
      d.catchFrames.length) *
    FRAME_BYTES_ESTIMATE
  );
}

export type DecodedReplayResult =
  | { ok: true; decoded: DecodedReplay; replayKey: string }
  | { ok: false; status: 404 | 422; error: string };

/**
 * Reads and decodes a replay file off the request path. The result is cached
 * by score id + file mtime + size, so rewriting the file invalidates it.
 */
export async function loadDecodedReplay(
  scoreId: string,
  replayPath: string,
): Promise<DecodedReplayResult> {
  let info;
  try {
    info = await stat(replayPath);
  } catch {
    return {
      ok: false,
      status: 404,
      error: "Replay file missing from lazer files store",
    };
  }
  const replayKey = `${scoreId}|${info.mtimeMs}|${info.size}`;
  const cached = decodedReplayCache.get(replayKey);
  if (cached) return { ok: true, decoded: cached, replayKey };

  return replayLimiter.run(async (): Promise<DecodedReplayResult> => {
    const again = decodedReplayCache.get(replayKey);
    if (again) return { ok: true, decoded: again, replayKey };
    let bytes: Buffer;
    try {
      bytes = await readFile(replayPath);
    } catch {
      return {
        ok: false,
        status: 404,
        error: "Replay file missing from lazer files store",
      };
    }
    try {
      const decoded = await decodeLegacyReplay(bytes);
      decodedReplayCache.set(replayKey, decoded, estimateDecodedBytes(decoded));
      return { ok: true, decoded, replayKey };
    } catch (err) {
      return {
        ok: false,
        status: 422,
        error:
          err instanceof Error
            ? `Failed to decode replay: ${err.message}`
            : "Failed to decode replay",
      };
    }
  });
}

/**
 * Returns cached `{judgments, summary}` for `key`, or runs `compute` under the
 * limiter after yielding to the event loop, then caches it.
 */
export async function judgeCached<J, S>(
  key: string,
  compute: () => CachedJudging<J, S>,
  cache: BoundedLru<CachedJudging<unknown, unknown>> = judgingCache,
  limiter: ConcurrencyLimiter = replayLimiter,
): Promise<CachedJudging<J, S>> {
  const hit = cache.get(key);
  if (hit) return hit as CachedJudging<J, S>;
  return limiter.run(async () => {
    const again = cache.get(key);
    if (again) return again as CachedJudging<J, S>;
    await yieldToEventLoop();
    const result = compute();
    cache.set(key, result, result.judgments.length * JUDGMENT_BYTES_ESTIMATE);
    return result;
  });
}
