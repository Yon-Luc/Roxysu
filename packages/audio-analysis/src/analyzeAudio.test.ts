import { describe, expect, test } from "bun:test";
import {
  analyzeDecodedAudio,
  detectOnsets,
  estimateBpm,
  synthesizeImpulseTrack,
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
    const { bpm, confidence } = estimateBpm(onsets);
    expect(bpm).toBe(120);
    expect(confidence).toBeGreaterThan(0.3);
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
  });
});
