import { describe, expect, test } from "bun:test";
import {
  BACKFILL_MAX_HEAP_RATIO,
  BACKFILL_MIN_HEADROOM_MB,
  describeMemoryPressure,
  BACKFILL_IN_MAP_MAX_HEAP_RATIO,
  isInMapMemoryPressure,
  isMemoryPressure,
  isMemoryPressureWithLimits,
  memoryHeadroom,
} from "./memoryPressure";

describe("memoryHeadroom", () => {
  test("reports a positive headroom for this process", () => {
    const m = memoryHeadroom();
    expect(Number.isFinite(m.rssMb)).toBe(true);
    expect(m.rssMb).toBeGreaterThan(0);
    expect(m.headroomMb).toBeGreaterThanOrEqual(0);
  });

  test("available memory is reported on Linux", () => {
    const m = memoryHeadroom();
    // CI and dev boxes are Linux; assert only when the platform exposes it.
    if (m.availableMb != null) expect(m.availableMb).toBeGreaterThan(0);
    if (m.swapFreeMb != null) expect(m.swapFreeMb).toBeGreaterThanOrEqual(0);
  });

  test("headroom accounts for swap on top of free RAM", () => {
    const m = memoryHeadroom();
    if (m.availableMb == null) return;
    expect(m.headroomMb).toBeGreaterThanOrEqual(m.availableMb);
  });
});

describe("heap counters", () => {
  test("reports the V8 heap and its ceiling under Node", () => {
    const m = memoryHeadroom();
    // `node:v8` resolves under both Bun and Node; a null here would mean the
    // heap ceiling check is silently disabled.
    expect(m.heapUsedMb).not.toBeNull();
    expect(m.heapLimitMb).not.toBeNull();
    expect(m.heapUsedMb!).toBeGreaterThan(0);
    expect(m.heapLimitMb!).toBeGreaterThan(0);
  });

  test("heapRatio is used / limit and stays in range for a live process", () => {
    const m = memoryHeadroom();
    const expected = m.heapUsedMb! / m.heapLimitMb!;
    expect(m.heapRatio!).toBeCloseTo(expected, 5);
    expect(m.heapRatio!).toBeGreaterThan(0);
    expect(m.heapRatio!).toBeLessThan(1);
  });
});

describe("isMemoryPressure", () => {
  test("an unreachable threshold always trips", () => {
    expect(isMemoryPressure(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  test("a zero threshold never trips", () => {
    expect(isMemoryPressure(0)).toBe(false);
  });

  test("threshold above current headroom trips", () => {
    const m = memoryHeadroom();
    expect(isMemoryPressure(m.headroomMb + 1024 * 1024)).toBe(true);
  });

  test("abundant RAM still trips when the heap ceiling is the binding limit", () => {
    // The reported crash happened on a machine with free RAM: Node hit its own
    // ~4 GB cap. OS headroom alone would have kept the job running.
    expect(isMemoryPressureWithLimits(0, Number.EPSILON)).toBe(true);
  });

  test("a ceiling above current heap usage does not trip", () => {
    expect(isMemoryPressureWithLimits(0, 2)).toBe(false);
  });
});

describe("describeMemoryPressure", () => {
  test("includes the process RSS", () => {
    expect(describeMemoryPressure()).toContain("MB");
  });

  test("surfaces the heap so the job panel shows the ceiling too", () => {
    expect(describeMemoryPressure()).toContain("heap ");
  });
});

describe("BACKFILL_MIN_HEADROOM_MB", () => {
  test("leaves room for a working set without being trigger-happy", () => {
    expect(BACKFILL_MIN_HEADROOM_MB).toBeGreaterThanOrEqual(256);
    expect(BACKFILL_MIN_HEADROOM_MB).toBeLessThanOrEqual(4096);
  });
});

describe("BACKFILL_MAX_HEAP_RATIO", () => {
  test("pauses before the heap ceiling is unreachable", () => {
    // A V8 heap abort is fatal and uncatchable, so the pause has to land with
    // real headroom left rather than at the limit.
    expect(BACKFILL_MAX_HEAP_RATIO).toBeGreaterThan(0.25);
    expect(BACKFILL_MAX_HEAP_RATIO).toBeLessThan(0.9);
  });
});

describe("BACKFILL_IN_MAP_MAX_HEAP_RATIO", () => {
  test("stops a chart before the between-map ceiling", () => {
    expect(BACKFILL_IN_MAP_MAX_HEAP_RATIO).toBeLessThan(BACKFILL_MAX_HEAP_RATIO);
    expect(BACKFILL_IN_MAP_MAX_HEAP_RATIO).toBeGreaterThan(0.25);
  });

  test("trips while the looser between-map check still has room", () => {
    expect(isInMapMemoryPressure(0)).toBe(isMemoryPressureWithLimits(0, BACKFILL_IN_MAP_MAX_HEAP_RATIO));
  });
});
