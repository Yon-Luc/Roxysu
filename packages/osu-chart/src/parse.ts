import { OsuFileParser } from "./osuFileParser.js";
import type { ChartNote, ParsedOsuChart } from "./types";

const HOLD_EPS_MS = 20;

export function isHold(note: ChartNote): boolean {
  return note.endMs > note.startMs + HOLD_EPS_MS;
}

export function notesFromParser(parser: OsuFileParser): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < parser.noteStarts.length; i += 1) {
    notes.push({
      column: parser.columns[i]!,
      startMs: parser.noteStarts[i]!,
      endMs: parser.noteEnds[i]!,
    });
  }
  notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);
  return notes;
}

/** Parse `.osu` text into a normalized chart representation. */
export function parseOsuChart(osuText: string): ParsedOsuChart {
  const parser = new OsuFileParser(osuText);
  parser.process();

  return {
    columnCount: parser.columnCount,
    gameMode: parser.gameMode,
    status: parser.status,
    lnRatio: parser.lnRatio,
    notes: notesFromParser(parser),
    timingPoints: parser.timingPoints,
    breaks: parser.breaks,
    metaData: parser.metaData,
  };
}

/** Parse and validate a 7k mania chart. */
export function parse7kChart(osuText: string): ParsedOsuChart {
  const chart = parseOsuChart(osuText);

  if (chart.status === "NotMania" || chart.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (chart.status === "Fail" || chart.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }
  if (chart.columnCount !== 7) {
    throw new Error(`Expected 7k chart, got ${chart.columnCount} keys`);
  }

  return chart;
}
