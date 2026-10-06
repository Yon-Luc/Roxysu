/**
 * Memory headroom checks for background backfill jobs.
 *
 * A backfill runs unattended over the whole library. On a busy desktop it can
 * push the machine into swap exhaustion, where the kernel's OOM killer starts
 * taking arbitrary processes — including the user's terminal. Jobs should pause
 * themselves when headroom is low rather than keep allocating.
 *
 * Two ceilings matter, not one. Free RAM can look healthy while V8 is already
 * near its own heap cap, and the resulting abort is fatal — so the V8 heap is
 * checked alongside `/proc/meminfo`. Elsewhere the OS figures degrade to the
 * process's own RSS, and the heap figures to null (never a false pause).
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

/**
 * Pause a backfill below this much headroom (RAM available + swap free).
 * 512 MB is enough to keep the desktop responsive while leaving room for the
 * job's own working set.
 */
export const BACKFILL_MIN_HEADROOM_MB = 512;

/**
 * Pause a backfill once V8's old space is this full.
 *
 * Free RAM is not the binding constraint here: a machine can have gigabytes
 * available while Node still hits its own heap cap, and a V8 "heap out of
 * memory" abort is fatal and uncatchable — the process dies and takes the
 * desktop shell with it. OS headroom alone cannot prevent it.
 */
export const BACKFILL_MAX_HEAP_RATIO = 0.65;

/**
 * Pause inside a single chart below this heap ratio.
 *
 * The between-map check is not enough: one synchronous difficulty graph can
 * climb from under {@link BACKFILL_MAX_HEAP_RATIO} to the V8 limit before the
 * next map. This ceiling leaves that chunk room to stop and release.
 */
export const BACKFILL_IN_MAP_MAX_HEAP_RATIO = 0.5;

export type MemoryHeadroom = {
  /** Available RAM in MB, or null when unknown. */
  availableMb: number | null;
  /** Free swap in MB, or null when unknown. */
  swapFreeMb: number | null;
  /** This process's RSS in MB. */
  rssMb: number;
  /** Best-effort headroom estimate in MB (available + swap free). */
  headroomMb: number;
  /** V8 heap in use in MB, or null when the runtime does not report it. */
  heapUsedMb: number | null;
  /** V8 heap ceiling in MB, or null when the runtime does not report it. */
  heapLimitMb: number | null;
  /** Heap used / heap limit, or null when the runtime does not report it. */
  heapRatio: number | null;
};

function readMeminfo(): Record<string, number> | null {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const out: Record<string, number> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)\s*kB$/);
      if (m) out[m[1]!] = Number(m[2]) / 1024;
    }
    return out;
  } catch {
    return null;
  }
}

/** V8 heap counters, or null when the runtime does not expose them. */
function readHeap(): Pick<MemoryHeadroom, "heapUsedMb" | "heapLimitMb" | "heapRatio"> {
  const none = {
    heapUsedMb: null,
    heapLimitMb: null,
    heapRatio: null,
  } as const;
  try {
    // Resolved lazily: `node:v8` does not exist under Bun, and this module is
    // loaded by both runtimes.
    const v8 = createRequire(import.meta.url)("node:v8") as {
      getHeapStatistics?: () => Record<string, number>;
    };
    const stats = v8.getHeapStatistics?.();
    if (!stats) return none;
    const usedMb = stats["used_heap_size"]! / 1024 / 1024;
    const limitMb = stats["heap_size_limit"]! / 1024 / 1024;
    return {
      heapUsedMb: usedMb,
      heapLimitMb: limitMb,
      heapRatio: limitMb > 0 ? usedMb / limitMb : null,
    };
  } catch {
    return none;
  }
}

/** Current memory headroom, or null when the platform reports nothing useful. */
export function memoryHeadroom(): MemoryHeadroom {
  const rssMb = process.memoryUsage.rss() / 1024 / 1024;
  const info = readMeminfo();
  const heap = readHeap();

  if (!info) {
    return {
      availableMb: null,
      swapFreeMb: null,
      rssMb,
      headroomMb: rssMb,
      ...heap,
    };
  }

  const availableMb = info["MemAvailable"] ?? null;
  const swapFreeMb = info["SwapFree"] ?? 0;
  // MemAvailable already discounts reclaimable page cache, so it is the figure
  // that matters; swap free only extends the runway.
  const headroomMb = availableMb == null ? swapFreeMb : availableMb + swapFreeMb;

  return { availableMb, swapFreeMb, rssMb, headroomMb, ...heap };
}

/**
 * True when the machine or the V8 heap is too tight for a backfill to continue.
 *
 * Either condition pauses the job. The heap check exists because a V8 heap
 * limit abort is fatal and cannot be caught, so it has to be caught before the
 * limit rather than after.
 */
export function isMemoryPressure(
  minHeadroomMb: number = BACKFILL_MIN_HEADROOM_MB,
): boolean {
  return isMemoryPressureWithLimits(minHeadroomMb, BACKFILL_MAX_HEAP_RATIO);
}

/**
 * True when a chart already in progress should stop.
 *
 * Pattern analysis and rework dan use this for both the in-map check and
 * their pause/resume. A map is only started while this is false, so a later
 * trip means that chart is the one growing the heap.
 */
export function isInMapMemoryPressure(
  minHeadroomMb: number = BACKFILL_MIN_HEADROOM_MB,
): boolean {
  return isMemoryPressureWithLimits(
    minHeadroomMb,
    BACKFILL_IN_MAP_MAX_HEAP_RATIO,
  );
}

export function isMemoryPressureWithLimits(
  minHeadroomMb: number,
  maxHeapRatio: number,
): boolean {
  const m = memoryHeadroom();
  if (m.headroomMb < minHeadroomMb) return true;
  return m.heapRatio != null && m.heapRatio > maxHeapRatio;
}

/** Short human-readable summary for the Settings job panel. */
export function describeMemoryPressure(): string {
  const m = memoryHeadroom();
  const parts: string[] = [`${Math.round(m.rssMb)} MB`];
  if (m.availableMb != null) parts.push(`${Math.round(m.availableMb)} MB free`);
  if (m.swapFreeMb != null && m.swapFreeMb > 0) {
    parts.push(`${Math.round(m.swapFreeMb)} MB swap free`);
  }
  if (m.heapRatio != null && m.heapLimitMb != null) {
    parts.push(
      `heap ${Math.round(m.heapUsedMb ?? 0)}/${Math.round(m.heapLimitMb)} MB`,
    );
  }
  return parts.join(" · ");
}