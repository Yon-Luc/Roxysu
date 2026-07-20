import { describe, expect, test } from "bun:test";
import {
  analyzeDecodedAudio,
  detectOnsets,
  estimateBpm,
  estimateTempoMap,
  synthesizeImpulseTrack,
  synthesizeTwoTempoTrack,
} from "./index";

describe("detectOnsets", () => {
  test("finds impulses in synthetic click track", () => {
    const decoded = synthesizeImpulseTrack(500, 8);
    const onsets = detectOnsets(decoded.samples, decoded.sampleRate, {
      onsetThreshold: 0.2,
      minOnsetIntervalSec: 0.2,
    });
    expect(onsets.length).toBeGreaterThanOrEqual(6);
  });
});

describe("estimateBpm", () => {
  test("estimates 120 BPM from 500ms IOI onsets", () => {
    const onsets = Array.from({ length: 16 }, (_, i) => ({
      timeMs: i * 500,
      strength: 1,
    }));
    const { bpm, confidence, alternates } = estimateBpm(onsets);
    expect(bpm).toBe(120);
    expect(confidence).toBeGreaterThan(0.3);
    expect(alternates).not.toContain(120);
  });

  test("prefers double-tempo when half is unusually slow", () => {
    // 882ms IOI ≈ 68 BPM raw; musical preference + slow-tempo boost → 136.
    const onsets = Array.from({ length: 24 }, (_, i) => ({
      timeMs: i * 882,
      strength: 1,
    }));
    const { bpm } = estimateBpm(onsets);
    expect(bpm).not.toBeNull();
    expect(bpm!).toBeGreaterThanOrEqual(120);
    expect(bpm!).toBeLessThanOrEqual(140);
  });
});

describe("analyzeDecodedAudio", () => {
  test("returns beats and sections for synthetic track", () => {
    const decoded = synthesizeImpulseTrack(500, 12);
    const result = analyzeDecodedAudio(decoded);
    expect(result.algorithm).toBe("audio-v1");
    expect(result.onsets.length).toBeGreaterThan(0);
    expect(result.bpm).not.toBeNull();
    expect(Math.abs(result.bpm! - 120)).toBeLessThanOrEqual(6);
    expect(result.beats.length).toBeGreaterThan(0);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.timingPoints.length).toBeGreaterThanOrEqual(1);
    expect(result.tempoMap.length).toBeGreaterThanOrEqual(1);
  });

  test("detects BPM change on two-tempo click track", () => {
    // Clear 120 → 160 shift with long halves so conservative detector fires.
    const decoded = synthesizeTwoTempoTrack(500, 60, 375, 60);
    const result = analyzeDecodedAudio(decoded);
    expect(result.tempoMap.length).toBeGreaterThanOrEqual(2);
    const bpms = result.tempoMap.map((s) => s.bpm);
    expect(bpms.some((b) => Math.abs(b - 120) <= 6)).toBe(true);
    expect(bpms.some((b) => Math.abs(b - 160) <= 8)).toBe(true);
    expect(result.timingPoints.length).toBeGreaterThanOrEqual(2);
  });

  test("keeps single tempo when onset BPM is low-confidence noise", () => {
    const onsets = [0, 400, 900, 1500, 2200, 4000, 7000, 11000].map(
      (timeMs) => ({ timeMs, strength: 1 }),
    );
    const map = estimateTempoMap(onsets, 20_000, 120, 0.1);
    expect(map.length).toBe(1);
  });
});
