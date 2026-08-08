import { describe, expect, test } from "bun:test";
import {
  ETA_MIN_SAMPLES,
  batchProcessedCount,
  batchProgressPct,
  estimateBatchEta,
  formatEtaMs,
} from "../../public/features/download/batchProgress";

describe("formatEtaMs", () => {
  test("formats seconds, minutes, and hours", () => {
    expect(formatEtaMs(12_000)).toBe("~12s left");
    expect(formatEtaMs(90_000)).toBe("~2m left");
    expect(formatEtaMs(3_700_000)).toBe("~1h 2m left");
  });
});

describe("batch progress helpers", () => {
  test("counts processed and percent", () => {
    const batch = {
      downloaded: 8,
      skippedExisting: 1,
      failed: 1,
      queued: 20,
    };
    expect(batchProcessedCount(batch)).toBe(10);
    expect(batchProgressPct(batch)).toBe(50);
  });
});

describe("estimateBatchEta", () => {
  test("waits for warm-up samples", () => {
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: ETA_MIN_SAMPLES - 1,
      downloadingStartedAtMs: Date.now() - 10_000,
      nowMs: Date.now(),
    });
    expect(eta).toEqual({ label: "Estimating…", ready: false });
  });

  test("estimates after warm-up", () => {
    const now = 1_000_000;
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: 10,
      downloadingStartedAtMs: now - 10_000,
      nowMs: now,
    });
    // 1s/map × 30 remaining
    expect(eta?.ready).toBe(true);
    expect(eta?.label).toBe("~30s left");
  });
});
