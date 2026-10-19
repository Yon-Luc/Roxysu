import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BoundedLru,
  ConcurrencyLimiter,
  judgeCached,
  loadDecodedReplay,
  decodedReplayCache,
} from "./replayRuntime";

const judging = () => new BoundedLru<{ judgments: unknown[]; summary: unknown }>(8, 1_000_000);

describe("judgeCached", () => {
  test("cache hit avoids re-judging", async () => {
    const cache = judging();
    const limiter = new ConcurrencyLimiter(2);
    let calls = 0;
    const compute = () => {
      calls += 1;
      return { judgments: [1, 2, 3], summary: { calls } };
    };
    const a = await judgeCached("k", compute, cache, limiter);
    const b = await judgeCached("k", compute, cache, limiter);
    expect(calls).toBe(1);
    expect(b).toBe(a);
    await judgeCached("other", compute, cache, limiter);
    expect(calls).toBe(2);
  });

  test("concurrent identical requests judge once", async () => {
    const cache = judging();
    const limiter = new ConcurrencyLimiter(1);
    let calls = 0;
    const compute = () => {
      calls += 1;
      return { judgments: [], summary: null };
    };
    await Promise.all([
      judgeCached("k", compute, cache, limiter),
      judgeCached("k", compute, cache, limiter),
      judgeCached("k", compute, cache, limiter),
    ]);
    expect(calls).toBe(1);
  });
});

describe("ConcurrencyLimiter", () => {
  test("bounds concurrent tasks and runs all of them in order", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n);
        active -= 1;
        return n;
      });
    const results = await Promise.all([1, 2, 3, 4, 5].map(task));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  test("a failing task releases its slot", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await limiter.run(() => 7)).toBe(7);
  });
});

describe("BoundedLru", () => {
  test("evicts least recently used by count and by bytes", () => {
    const lru = new BoundedLru<number>(2, 100);
    lru.set("a", 1, 10);
    lru.set("b", 2, 10);
    lru.get("a");
    lru.set("c", 3, 10);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);

    lru.set("d", 4, 95);
    expect(lru.size).toBe(1);
    expect(lru.bytes).toBe(95);
    lru.set("huge", 5, 101);
    expect(lru.get("huge")).toBeUndefined();
  });
});

describe("loadDecodedReplay", () => {
  test("missing file is 404, undecodable file is 422 and not cached", async () => {
    const missing = await loadDecodedReplay("s1", "/nonexistent/replay.osr");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    const dir = mkdtempSync(join(tmpdir(), "rr-"));
    const file = join(dir, "bad.osr");
    writeFileSync(file, Buffer.from([1, 2, 3]));
    const sizeBefore = decodedReplayCache.size;
    const bad = await loadDecodedReplay("s2", file);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(422);
      expect(bad.error).toContain("Failed to decode replay");
    }
    // Failures are not cached.
    expect(decodedReplayCache.size).toBe(sizeBefore);
  });
});
