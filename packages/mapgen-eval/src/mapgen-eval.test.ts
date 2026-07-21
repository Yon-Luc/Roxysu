import { describe, expect, test } from "bun:test";
import {
  buildMarkovTransitionTable,
  buildReferenceStats,
  pickRegressionCandidates,
  scoreMapgenChart,
} from "./index";
import type { ManiaOsuChart, ParsedOsuChart } from "../../osu-chart/src/index";

function makeChart(
  title: string,
  bpm: number,
  notes: Array<{ column: number; startMs: number; endMs?: number }>,
): ManiaOsuChart {
  return {
    metadata: {
      title,
      artist: "T",
      creator: "Test",
      version: "Generated",
      audioFilename: "audio.mp3",
    },
    difficulty: {
      columnCount: 7,
      overallDifficulty: 7,
      hpDrainRate: 7,
    },
    timingPoints: [[0, 60_000 / bpm]],
    notes: notes.map((note) => ({
      column: note.column,
      startMs: note.startMs,
      endMs: note.endMs ?? note.startMs,
    })),
  };
}

function toParsed(chart: ManiaOsuChart): ParsedOsuChart {
  return {
    columnCount: chart.difficulty.columnCount,
    gameMode: "3",
    status: "Ok",
    lnRatio: chart.notes.filter((note) => note.endMs > note.startMs).length / chart.notes.length,
    notes: chart.notes,
    timingPoints: chart.timingPoints,
    breaks: [],
    metaData: {},
  };
}

describe("mapgen-eval", () => {
  test("builds reference stats and scores generated charts", () => {
    const chartA = makeChart("A", 120, [
      { column: 0, startMs: 0 },
      { column: 1, startMs: 500 },
      { column: 2, startMs: 1000 },
      { column: 3, startMs: 1500, endMs: 2000 },
      { column: 4, startMs: 2000 },
      { column: 5, startMs: 2500 },
      { column: 6, startMs: 3000 },
    ]);
    const chartB = makeChart("B", 140, [
      { column: 0, startMs: 0 },
      { column: 2, startMs: 429 },
      { column: 4, startMs: 858 },
      { column: 6, startMs: 1287, endMs: 1716 },
      { column: 5, startMs: 1716 },
      { column: 3, startMs: 2145 },
      { column: 1, startMs: 2574 },
    ]);

    const stats = buildReferenceStats([
      { chart: chartA, sunnyStar: 4, explicitBpm: 120 },
      { chart: chartB, sunnyStar: 4.5, explicitBpm: 140 },
    ]);

    expect(stats.totalCharts).toBe(2);
    expect(stats.buckets.length).toBeGreaterThan(0);

    const score = scoreMapgenChart(
      { chart: chartB, sunnyStar: 4.5, explicitBpm: 140 },
      stats,
    );
    expect(score.snapshot.noteCount).toBeGreaterThan(0);
    expect(score.rc.illegalOverlaps).toBe(0);
  });

  test("builds Markov transition tables and balanced regression picks", () => {
    const table = buildMarkovTransitionTable(
      [0, 1, 2].map((i) => ({
        beatmapId: `b${i}`,
        bpm: 128 + i * 8,
        starRating: 4 + i * 0.5,
        chart: toParsed(
          makeChart(`Chart ${i}`, 128 + i * 8, [
            { column: 0, startMs: 0 },
            { column: 1 + i, startMs: 400 },
            { column: 2 + i, startMs: 800 },
            { column: 3 + i, startMs: 1200, endMs: 1600 },
            { column: 4 + i, startMs: 1600 },
          ]),
        ),
      })),
    );
    expect(table.transitions.length).toBeGreaterThan(0);

    const regression = pickRegressionCandidates(
      [
        {
          beatmapId: "a",
          title: "A",
          artist: "X",
          difficultyName: "D1",
          bpm: 128,
          starRating: 4,
          mapperUsername: "m1",
          audioFileHash: "hash-a",
        },
        {
          beatmapId: "b",
          title: "B",
          artist: "Y",
          difficultyName: "D2",
          bpm: 148,
          starRating: 4.5,
          mapperUsername: "m2",
          audioFileHash: "hash-b",
        },
      ],
      2,
    );
    expect(regression).toHaveLength(2);
  });
});
