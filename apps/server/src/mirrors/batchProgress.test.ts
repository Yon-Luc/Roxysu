import { describe, expect, test } from "bun:test";
import {
  ETA_MIN_SAMPLES,
  batchNetworkSampleCount,
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
      inFlight: 0,
    };
    expect(batchProcessedCount(batch)).toBe(10);
    expect(batchNetworkSampleCount(batch)).toBe(9);
    expect(batchProgressPct(batch)).toBe(50);
  });

  test("gives half-credit for in-flight downloads", () => {
    const batch = {
      downloaded: 0,
      skippedExisting: 0,
      failed: 0,
      queued: 10,
      inFlight: 4,
    };
    expect(batchProgressPct(batch)).toBe(20);
  });
});

describe("estimateBatchEta", () => {
  test("ignores skip-only processed counts for warm-up", () => {
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: 25,
      networkSamples: ETA_MIN_SAMPLES - 1,
      etaStartedAtMs: Date.now() - 10_000,
      nowMs: Date.now(),
    });
    expect(eta).toEqual({ label: "Estimating…", ready: false });
  });

  test("waits for warm-up network samples", () => {
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: ETA_MIN_SAMPLES - 1,
      networkSamples: ETA_MIN_SAMPLES - 1,
      etaStartedAtMs: Date.now() - 10_000,
      nowMs: Date.now(),
    });
    expect(eta).toEqual({ label: "Estimating…", ready: false });
  });

  test("estimates after warm-up using network sample rate", () => {
    const now = 1_000_000;
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: 15,
      networkSamples: 10,
      etaStartedAtMs: now - 10_000,
      nowMs: now,
    });
    expect(eta?.ready).toBe(true);
    // avg 1s/network sample × 25 remaining = 25s
    expect(eta?.label).toBe("~25s left");
  });

  test("uses a stable epoch so remount mid-batch keeps the rate", () => {
    const downloadStart = 1_000_000;
    const remountNow = downloadStart + 20_000;
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: 20,
      networkSamples: 20,
      etaStartedAtMs: downloadStart,
      nowMs: remountNow,
    });
    expect(eta?.ready).toBe(true);
    expect(eta?.label).toBe("~20s left");
  });

  test("labels the terminal phase as wrapping up", () => {
    const eta = estimateBatchEta({
      phase: "downloading",
      queued: 40,
      processed: 40,
      networkSamples: 40,
      etaStartedAtMs: Date.now() - 10_000,
      nowMs: Date.now(),
    });
    expect(eta).toEqual({ label: "Wrapping up…", ready: false });
  });
});
