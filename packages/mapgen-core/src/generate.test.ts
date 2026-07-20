import { describe, expect, test } from "bun:test";
import { parseOsuChart, isHold } from "@roxysu/osu-chart";
import {
  analyzeDecodedAudio,
  synthesizeImpulseTrack,
  synthesizeTwoTempoTrack,
} from "@roxysu/audio-analysis";
import {
  analyzeGeneratedPatterns,
  buildManiaOsuText,
  generateMapFromAudio,
} from "./index";

describe("generateMapFromAudio", () => {
  test("produces parseable 7k osu from synthetic audio", () => {
    const decoded = synthesizeImpulseTrack(500, 32);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      { delay: 0.6, jack: 0.2, ln: 0.1 },
      {
        seed: 42,
        bpm: 120,
        endMs: 8000,
        metadata: { title: "Test", artist: "T" },
      },
    );

    expect(result.notes.length).toBeGreaterThan(10);
    expect(result.segments.length).toBeGreaterThan(0);

    const osuText = buildManiaOsuText(result.chart);
    const parsed = parseOsuChart(osuText);
    expect(parsed.gameMode).toBe("3");
    expect(parsed.columnCount).toBe(7);
    expect(parsed.notes.length).toBe(result.notes.length);

    const patterns = analyzeGeneratedPatterns(result.notes);
    expect(patterns.dominantPattern).toBeTruthy();
  });

  test("writes holds that round-trip as LNs", () => {
    const decoded = synthesizeImpulseTrack(500, 24);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0.5 },
      {
        seed: 7,
        bpm: 120,
        timingOffsetMs: 0,
        endMs: 4000,
        metadata: { title: "LN", artist: "T" },
      },
    );

    const holdCount = result.notes.filter((n) => isHold(n)).length;
    expect(holdCount).toBeGreaterThan(0);

    const parsed = parseOsuChart(buildManiaOsuText(result.chart));
    const parsedHolds = parsed.notes.filter((n) => isHold(n)).length;
    expect(parsedHolds).toBe(holdCount);
    expect(parsed.lnRatio).toBeGreaterThan(0.2);
  });

  test("aligns notes to timing offset", () => {
    const decoded = synthesizeImpulseTrack(500, 20);
    const audio = analyzeDecodedAudio(decoded);
    const offset = 2500;
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0 },
      {
        seed: 1,
        bpm: 120,
        timingOffsetMs: offset,
        endMs: offset + 2000,
        metadata: { title: "Offset", artist: "T" },
      },
    );

    expect(result.timingOffsetMs).toBe(offset);
    expect(result.chart.timingPoints[0]![0]).toBe(offset);
    expect(result.notes[0]!.startMs).toBeGreaterThanOrEqual(offset);
  });

  test("writes multiple timing points when audio has tempo changes", () => {
    const decoded = synthesizeTwoTempoTrack(500, 28, 375, 28);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0 },
      {
        seed: 2,
        timingOffsetMs: 0,
        endMs: audio.durationMs,
        metadata: { title: "Tempo", artist: "T" },
      },
    );

    expect(result.timingPoints.length).toBeGreaterThanOrEqual(2);
    expect(result.chart.timingPoints.length).toBe(
      result.timingPoints.length,
    );
  });

  test("dan preset applies density and LN floor for LN axis", () => {
    const decoded = synthesizeImpulseTrack(500, 32);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      {},
      {
        seed: 3,
        bpm: 120,
        timingOffsetMs: 0,
        endMs: 6000,
        dan: "ln-5",
        metadata: { title: "Dan", artist: "T" },
      },
    );

    expect(result.dan?.label).toBe("LN 5");
    expect(result.targets.ln).toBeGreaterThanOrEqual(0.2);
    expect(result.chart.metadata.version).toBe("LN 5");
  });
});
