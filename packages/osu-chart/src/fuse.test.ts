import { describe, expect, test } from "bun:test";
import {
  checkFusedMatchesOriginals,
  fuseManiaCharts,
  parseTimingPointRows,
} from "./fuse";

function maniaOsu(opts: {
  version: string;
  cs: number;
  notes: string[];
  timing?: string[];
  hp?: number;
  od?: number;
}): string {
  return [
    "osu file format v14",
    "[General]",
    "Mode:3",
    "AudioFilename:audio.mp3",
    "[Metadata]",
    "Title:T",
    "Artist:A",
    "Creator:C",
    `Version:${opts.version}`,
    "[Difficulty]",
    `HPDrainRate:${opts.hp ?? 7}`,
    `CircleSize:${opts.cs}`,
    `OverallDifficulty:${opts.od ?? 8}`,
    "[TimingPoints]",
    ...(opts.timing ?? ["0,500,4,2,0,100,1,0"]),
    "[HitObjects]",
    ...opts.notes,
    "",
  ].join("\n");
}

describe("fuseManiaCharts", () => {
  test("offsets notes and timing by audio duration plus pause", () => {
    const a = maniaOsu({
      version: "1",
      cs: 4,
      notes: ["64,192,100,1,0,0:0:0:0:"],
    });
    const b = maniaOsu({
      version: "2",
      cs: 4,
      notes: ["192,192,50,1,0,0:0:0:0:"],
      timing: ["0,400,4,2,0,100,1,0", "200,-50,4,2,0,100,0,0"],
    });

    const fused = fuseManiaCharts(
      [
        { osuText: a, audioDurationMs: 1000 },
        { osuText: b, audioDurationMs: 800 },
      ],
      {
        pauseMs: 200,
        metadata: {
          title: "Marathon",
          artist: "Various",
          creator: "Roxysu",
          version: "4K",
          audioFilename: "audio.m4a",
          backgroundFilename: "bg.jpg",
        },
      },
    );

    expect(fused.keyCount).toBe(4);
    expect(fused.segmentStartsMs).toEqual([0, 1200]);
    expect(fused.totalDurationMs).toBe(2000);
    expect(fused.chart.notes.map((n) => n.startMs)).toEqual([100, 1250]);
    expect(fused.chart.breaks).toEqual([[1000, 1200]]);

    const uninherited = fused.chart.fullTimingPoints!.filter(
      (p) => p.uninherited !== false,
    );
    expect(uninherited.map((p) => p.timeMs)).toEqual([0, 1200]);
    const inherited = fused.chart.fullTimingPoints!.filter(
      (p) => p.uninherited === false,
    );
    expect(inherited).toHaveLength(1);
    expect(inherited[0]!.timeMs).toBe(1400);
    expect(inherited[0]!.beatLength).toBe(-50);

    expect(fused.osuText).toContain("AudioFilename: audio.m4a");
    expect(fused.osuText).toContain('0,0,"bg.jpg",0,0');
    expect(fused.osuText).toContain("2,1000,1200");
    expect(fused.osuText).toContain("Tags:roxysu");
    expect(checkFusedMatchesOriginals(
      [
        { osuText: a, audioDurationMs: 1000 },
        { osuText: b, audioDurationMs: 800 },
      ],
      fused,
    ).ok).toBe(true);
  });

  test("detects BPM and note drift versus originals", () => {
    const a = maniaOsu({
      version: "1",
      cs: 4,
      notes: ["64,192,100,1,0,0:0:0:0:"],
    });
    const b = maniaOsu({
      version: "2",
      cs: 4,
      notes: ["192,192,50,1,0,0:0:0:0:"],
    });
    const fused = fuseManiaCharts(
      [
        { osuText: a, audioDurationMs: 1000 },
        { osuText: b, audioDurationMs: 800 },
      ],
      {
        pauseMs: 0,
        metadata: {
          title: "X",
          artist: "Y",
          creator: "Z",
          version: "M",
          audioFilename: "audio.wav",
        },
      },
    );

    const drifted = {
      ...fused,
      chart: {
        ...fused.chart,
        notes: fused.chart.notes.map((n, i) =>
          i === 1 ? { ...n, startMs: n.startMs + 25 } : n,
        ),
        fullTimingPoints: fused.chart.fullTimingPoints?.map((row, i) =>
          i === 0 ? { ...row, beatLength: 400 } : row,
        ),
      },
    };
    const check = checkFusedMatchesOriginals(
      [
        { osuText: a, audioDurationMs: 1000 },
        { osuText: b, audioDurationMs: 800 },
      ],
      drifted,
    );
    expect(check.ok).toBe(false);
    expect(check.mismatches.some((m) => m.kind === "bpm")).toBe(true);
    expect(check.mismatches.some((m) => m.kind === "note_time" || m.kind === "note_count")).toBe(
      true,
    );
  });

  test("rejects mixed key counts and non-mania", () => {
    const four = maniaOsu({
      version: "4k",
      cs: 4,
      notes: ["64,192,100,1,0,0:0:0:0:"],
    });
    const seven = maniaOsu({
      version: "7k",
      cs: 7,
      notes: ["36,192,100,1,0,0:0:0:0:"],
    });
    expect(() =>
      fuseManiaCharts(
        [
          { osuText: four, audioDurationMs: 500 },
          { osuText: seven, audioDurationMs: 500 },
        ],
        {
          pauseMs: 0,
          metadata: {
            title: "X",
            artist: "Y",
            creator: "Z",
            version: "M",
            audioFilename: "a.mp3",
          },
        },
      ),
    ).toThrow(/Mixed key counts/);

    const std = four.replace("Mode:3", "Mode:0");
    expect(() =>
      fuseManiaCharts(
        [
          { osuText: four, audioDurationMs: 500 },
          { osuText: std, audioDurationMs: 500 },
        ],
        {
          pauseMs: 0,
          metadata: {
            title: "X",
            artist: "Y",
            creator: "Z",
            version: "M",
            audioFilename: "a.mp3",
          },
        },
      ),
    ).toThrow(/not mania/);
  });

  test("parseTimingPointRows keeps inherited SV", () => {
    const rows = parseTimingPointRows(
      "[TimingPoints]\n0,500,4,2,0,100,1,0\n120,-80,4,2,0,80,0,0\n",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.uninherited).toBe(true);
    expect(rows[1]!.uninherited).toBe(false);
    expect(rows[1]!.beatLength).toBe(-80);
    expect(rows[1]!.volume).toBe(80);
  });
});
