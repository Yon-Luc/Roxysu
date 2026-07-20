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
  findEmptyColumns,
  findIllegalOverlaps,
  generateMapFromAudio,
  sanitizeManiaNotes,
} from "./index";

describe("sanitizeManiaNotes", () => {
  test("removes same-column duplicate timestamps", () => {
    const notes = sanitizeManiaNotes([
      { column: 0, startMs: 100, endMs: 100 },
      { column: 0, startMs: 100, endMs: 100 },
      { column: 1, startMs: 100, endMs: 100 },
    ]);
    expect(notes.filter((n) => n.column === 0)).toHaveLength(1);
    expect(findIllegalOverlaps(notes)).toHaveLength(0);
  });

  test("removes rice inside an LN body on the same column", () => {
    const notes = sanitizeManiaNotes([
      { column: 3, startMs: 0, endMs: 500 },
      { column: 3, startMs: 200, endMs: 200 },
      { column: 3, startMs: 500, endMs: 500 },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[1]!.startMs).toBe(500);
    expect(findIllegalOverlaps(notes)).toHaveLength(0);
  });

  test("allows a new head exactly on LN release", () => {
    const notes = sanitizeManiaNotes([
      { column: 2, startMs: 0, endMs: 400 },
      { column: 2, startMs: 400, endMs: 400 },
    ]);
    expect(notes).toHaveLength(2);
    expect(findIllegalOverlaps(notes)).toHaveLength(0);
  });

  test("caps chords at 6", () => {
    const chord = Array.from({ length: 7 }, (_, column) => ({
      column,
      startMs: 1000,
      endMs: 1000,
    }));
    const notes = sanitizeManiaNotes(chord, { maxChordSize: 6 });
    expect(notes).toHaveLength(6);
  });
});

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

    expect(result.notes.length).toBeGreaterThan(5);
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
    const decoded = synthesizeImpulseTrack(500, 48);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0.5 },
      {
        seed: 7,
        bpm: 120,
        timingOffsetMs: 0,
        endMs: 12_000,
        metadata: { title: "LN", artist: "T" },
      },
    );

    const holdCount = result.notes.filter((n) => isHold(n)).length;
    expect(holdCount).toBeGreaterThan(0);

    const parsed = parseOsuChart(buildManiaOsuText(result.chart));
    const parsedHolds = parsed.notes.filter((n) => isHold(n)).length;
    expect(parsedHolds).toBe(holdCount);
    expect(parsed.lnRatio).toBeGreaterThan(0.15);
  });

  test("aligns notes to timing offset", () => {
    const decoded = synthesizeImpulseTrack(500, 40);
    const audio = analyzeDecodedAudio(decoded);
    const offset = 2500;
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0 },
      {
        seed: 1,
        bpm: 120,
        timingOffsetMs: offset,
        endMs: offset + 8000,
        metadata: { title: "Offset", artist: "T" },
      },
    );

    expect(result.timingOffsetMs).toBe(offset);
    expect(result.chart.timingPoints[0]![0]).toBe(offset);
    if (result.notes.length > 0) {
      expect(result.notes[0]!.startMs).toBeGreaterThanOrEqual(offset);
    }
  });

  test("writes multiple timing points when audio has tempo changes", () => {
    const decoded = synthesizeTwoTempoTrack(500, 60, 375, 60);
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

  test("dan LN preset keeps real LN ratio above Sunny threshold", () => {
    const decoded = synthesizeImpulseTrack(441, 220);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      {},
      {
        seed: 9,
        bpm: 136,
        timingOffsetMs: 0,
        endMs: 60_000,
        dan: "ln-8",
        metadata: { title: "LN8", artist: "T" },
      },
    );

    const osuText = buildManiaOsuText(result.chart);
    const parsed = parseOsuChart(osuText);
    expect(parsed.lnRatio).toBeGreaterThanOrEqual(0.2);
    expect(result.dan?.label).toBe("LN 8");
  });

  test("generated charts have no illegal overlaps and use all columns", () => {
    const decoded = synthesizeImpulseTrack(441, 200);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      {},
      {
        seed: 11,
        bpm: 136,
        timingOffsetMs: 0,
        endMs: 60_000,
        dan: "ln-6",
        metadata: { title: "Legal", artist: "T" },
      },
    );

    expect(findIllegalOverlaps(result.notes)).toHaveLength(0);
    expect(findEmptyColumns(result.notes, 7)).toHaveLength(0);
  });

  test("places notes near musical onsets rather than filling every snap", () => {
    const decoded = synthesizeImpulseTrack(500, 40);
    const audio = analyzeDecodedAudio(decoded);
    const result = generateMapFromAudio(
      audio,
      { delay: 1, ln: 0 },
      {
        seed: 3,
        bpm: 120,
        timingOffsetMs: 0,
        endMs: 10_000,
        metadata: { title: "Music", artist: "T" },
      },
    );

    // At 120 BPM / 1/4 for 10s a naive fill would be ~80 hits; music grid
    // should land near the ~20 impulses (plus some beat fills).
    expect(result.notes.length).toBeGreaterThan(5);
    expect(result.notes.length).toBeLessThan(60);

    const onsetTimes = new Set(
      audio.onsets.map((o) => Math.round(o.timeMs / 50) * 50),
    );
    const nearOnset = result.notes.filter((n) => {
      const bucket = Math.round(n.startMs / 50) * 50;
      return (
        onsetTimes.has(bucket) ||
        onsetTimes.has(bucket - 50) ||
        onsetTimes.has(bucket + 50)
      );
    });
    expect(nearOnset.length / result.notes.length).toBeGreaterThan(0.4);
  });
});
