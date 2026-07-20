import { describe, expect, test } from "bun:test";
import { parseOsuChart } from "@roxysu/osu-chart";
import {
  analyzeDecodedAudio,
  synthesizeImpulseTrack,
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
});
