import { afterEach, describe, expect, test } from "bun:test";
import {
  FULL_GC_EVERY,
  canCollect,
  collectNow,
  yieldForBackfill,
} from "./jobYield";

const g = globalThis as {
  gc?: (full?: boolean) => void;
  Bun?: { gc?: (full?: boolean) => void };
};

/**
 * This suite runs under Bun, where `Bun.gc` always wins over `global.gc`. Both
 * branches matter — the desktop server is Node and reaches `global.gc` only via
 * `--expose-gc` — so the Bun collector is stubbed aside to exercise each path.
 */
function withoutBunGc<T>(run: () => T): T {
  const bunGc = g.Bun?.gc;
  if (g.Bun) g.Bun.gc = undefined;
  try {
    return run();
  } finally {
    if (g.Bun && bunGc) g.Bun.gc = bunGc;
  }
}

afterEach(() => {
  delete g.gc;
});

describe("collectNow", () => {
  test("uses Bun's collector when present", () => {
    const calls: unknown[] = [];
    const original = g.Bun!.gc!;
    g.Bun!.gc = (full?: boolean) => calls.push(full);
    try {
      expect(collectNow()).toBe(true);
      expect(calls).toEqual([true]);
    } finally {
      g.Bun!.gc = original;
    }
  });

  test("falls back to Node's global.gc when --expose-gc is on", () => {
    withoutBunGc(() => {
      const calls: unknown[] = [];
      g.gc = (full?: boolean) => calls.push(full);
      expect(collectNow()).toBe(true);
      expect(calls).toEqual([true]);
    });
  });

  test("reports failure instead of throwing when no collector is exposed", () => {
    withoutBunGc(() => {
      expect(collectNow()).toBe(false);
    });
  });
});

describe("canCollect", () => {
  test("true when a collector is reachable", () => {
    expect(canCollect()).toBe(true);
  });

  test("false with neither collector", () => {
    expect(withoutBunGc(() => canCollect())).toBe(false);
  });

  test("true with only global.gc", () => {
    withoutBunGc(() => {
      g.gc = () => {};
      expect(canCollect()).toBe(true);
    });
  });
});

describe("yieldForBackfill", () => {
  test("counts maps and forces a collection every FULL_GC_EVERY maps", async () => {
    const calls: unknown[] = [];
    const original = g.Bun!.gc!;
    g.Bun!.gc = (full?: boolean) => calls.push(full);
    try {
      const counter = { count: 0 };
      for (let i = 0; i < FULL_GC_EVERY; i++) await yieldForBackfill(counter);

      expect(counter.count).toBe(FULL_GC_EVERY);
      expect(calls).toEqual([true]);
    } finally {
      g.Bun!.gc = original;
    }
  });

  test("yields without collecting between collections", async () => {
    const calls: unknown[] = [];
    const original = g.Bun!.gc!;
    g.Bun!.gc = (full?: boolean) => calls.push(full);
    try {
      const counter = { count: 0 };
      await yieldForBackfill(counter);
      await yieldForBackfill(counter);

      expect(counter.count).toBe(2);
      expect(calls).toEqual([]);
    } finally {
      g.Bun!.gc = original;
    }
  });
});
