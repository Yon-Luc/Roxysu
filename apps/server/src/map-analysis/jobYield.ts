/**
 * Cooperative yielding for backfill jobs.
 *
 * A backfill rates many maps in a row. Each map's hit-object graph is a large
 * object cycle that only becomes garbage once the calculation returns, so a
 * long synchronous loop starves the collector and resident memory climbs until
 * the OS OOM-kills the process. Yielding after every map and forcing a
 * collection periodically keeps peak memory bounded to roughly one map.
 *
 * The forced collection needs an exposed collector: `Bun.gc` always, Node only
 * under `--expose-gc`. Without it the loop still yields, but the note graphs
 * wait for V8 to decide to collect them.
 */

/** Maps between forced full collections. */
export const FULL_GC_EVERY = 16;

/**
 * Force a full collection with whichever collector the runtime exposes.
 *
 * Bun always has one. Node only does with `--expose-gc`, which the desktop
 * shell passes via `NODE_OPTIONS`; without it this returns false and the caller
 * falls back to plain yielding.
 */
export function collectNow(): boolean {
  const bunGc = (
    globalThis as { Bun?: { gc?: (force?: boolean) => void } }
  ).Bun?.gc;
  if (typeof bunGc === "function") {
    bunGc(true);
    return true;
  }
  const nodeGc = (globalThis as { gc?: (full?: boolean) => void }).gc;
  if (typeof nodeGc === "function") {
    nodeGc(true);
    return true;
  }
  return false;
}

/** True when the runtime can be asked to collect on demand. */
export function canCollect(): boolean {
  const bunGc = (
    globalThis as { Bun?: { gc?: unknown } }
  ).Bun?.gc;
  if (typeof bunGc === "function") return true;
  return typeof (globalThis as { gc?: unknown }).gc === "function";
}

/**
 * Hand the event loop a turn and, every {@link FULL_GC_EVERY} calls, run a full
 * collection. Cheap enough to call per map; the forced collection is what
 * actually returns the note graphs.
 */
export async function yieldForBackfill(
  counter: { count: number },
): Promise<void> {
  counter.count += 1;

  // Yielding is enough for the nursery; a full collect is only needed
  // periodically, and it is expensive.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  if (counter.count % FULL_GC_EVERY === 0) {
    collectNow();
  }
}