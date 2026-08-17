import type { ChartNote } from "./types";

export type TimingPointRow = {
  timeMs: number;
  beatLength: number;
  meter?: number;
  sampleSet?: number;
  sampleIndex?: number;
  volume?: number;
  uninherited?: boolean;
  effects?: number;
};

export type ManiaOsuMetadata = {
  title: string;
  artist: string;
  creator: string;
  version: string;
  audioFilename: string;
  backgroundFilename?: string;
  previewTime?: number;
  tags?: string;
};

export type ManiaOsuDifficulty = {
  columnCount: number;
  hpDrainRate?: number;
  circleSize?: number;
  overallDifficulty?: number;
  approachRate?: number;
  sliderMultiplier?: number;
  sliderTickRate?: number;
};

export type ManiaOsuChart = {
  metadata: ManiaOsuMetadata;
  difficulty: ManiaOsuDifficulty;
  timingPoints: Array<[number, number]>;
  fullTimingPoints?: TimingPointRow[];
  breaks?: Array<[number, number]>;
  notes: ChartNote[];
};

function columnToX(column: number, columnCount: number): number {
  return Math.trunc(((column + 0.5) * 512) / columnCount);
}

function formatHitObject(
  note: ChartNote,
  columnCount: number,
): string {
  const x = columnToX(note.column, columnCount);
  const isHold = note.endMs > note.startMs + 20;
  const type = isHold ? 128 : 1;
  // Hold syntax: x,y,time,type,hitSound,endTime:hitSample
  if (isHold) {
    return `${x},192,${Math.round(note.startMs)},${type},0,${Math.round(note.endMs)}:0:0:0:0:`;
  }
  return `${x},192,${Math.round(note.startMs)},${type},0,0:0:0:0:`;
}

/** Serialize a mania chart to `.osu` file text. */
export function buildManiaOsuText(chart: ManiaOsuChart): string {
  const md = chart.metadata;
  const diff = chart.difficulty;
  const cs = diff.columnCount;
  const lines: string[] = [
    "osu file format v14",
    "",
    "[General]",
    "Mode:3",
    `AudioFilename: ${md.audioFilename}`,
    "AudioLeadIn:0",
    `PreviewTime:${md.previewTime ?? -1}`,
    "Countdown:0",
    "SampleSet:Soft",
    "StackLeniency:0.7",
    "LetterboxInBreaks:0",
    "SpecialStyle:0",
    "WidescreenStoryboard:0",
    "EpilepsyWarning:0",
    "",
    "[Metadata]",
    `Title:${md.title}`,
    `TitleUnicode:${md.title}`,
    `Artist:${md.artist}`,
    `ArtistUnicode:${md.artist}`,
    `Creator:${md.creator}`,
    `Version:${md.version}`,
    "Source:",
    `Tags:${md.tags ?? "roxysu"}`,
    "BeatmapID:0",
    "BeatmapSetID:-1",
    "",
    "[Difficulty]",
    `HPDrainRate:${diff.hpDrainRate ?? 7}`,
    `CircleSize:${cs}`,
    `OverallDifficulty:${diff.overallDifficulty ?? 8}`,
    `ApproachRate:${diff.approachRate ?? 5}`,
    `SliderMultiplier:${diff.sliderMultiplier ?? 1.4}`,
    `SliderTickRate:${diff.sliderTickRate ?? 1}`,
    "",
    "[Events]",
    "//Background and video events",
  ];

  if (md.backgroundFilename) {
    const escaped = md.backgroundFilename.replace(/"/g, "");
    lines.push(`0,0,"${escaped}",0,0`);
  }

  for (const [startMs, endMs] of chart.breaks ?? []) {
    lines.push(`2,${Math.round(startMs)},${Math.round(endMs)}`);
  }

  lines.push("", "[TimingPoints]");

  const rows: TimingPointRow[] =
    chart.fullTimingPoints && chart.fullTimingPoints.length > 0
      ? chart.fullTimingPoints
      : chart.timingPoints.map(([timeMs, beatLength]) => ({
          timeMs,
          beatLength,
          uninherited: true,
        }));

  for (const row of rows) {
    const uninherited = row.uninherited === false ? 0 : 1;
    const beat =
      uninherited === 1 ? row.beatLength.toFixed(12) : String(row.beatLength);
    lines.push(
      [
        Math.round(row.timeMs),
        beat,
        row.meter ?? 4,
        row.sampleSet ?? 2,
        row.sampleIndex ?? 0,
        row.volume ?? 100,
        uninherited,
        row.effects ?? 0,
      ].join(","),
    );
  }

  lines.push("", "[HitObjects]");

  const sorted = [...chart.notes].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );
  for (const note of sorted) {
    lines.push(formatHitObject(note, cs));
  }

  lines.push("");
  return lines.join("\n");
}
