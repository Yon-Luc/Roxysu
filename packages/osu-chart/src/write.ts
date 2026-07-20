import type { ChartNote } from "./types";

export type ManiaOsuMetadata = {
  title: string;
  artist: string;
  creator: string;
  version: string;
  audioFilename: string;
  /** Optional background image filename referenced in [Events]. */
  backgroundFilename?: string;
  previewTime?: number;
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
  /** Uninherited timing points: [timeMs, beatLengthMs]. */
  timingPoints: Array<[number, number]>;
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
    `AudioFilename:${md.audioFilename}`,
    "AudioLeadIn:0",
    "PreviewTime:-1",
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
    "Tags:roxysu mapgen",
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

  lines.push("", "[TimingPoints]");

  for (const [timeMs, beatLengthMs] of chart.timingPoints) {
    lines.push(`${Math.round(timeMs)},${beatLengthMs.toFixed(12)},4,2,0,100,1,0`);
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
