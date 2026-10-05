import type { ParsedOsuChart } from "@roxysu/osu-chart";
import type { ManiaBeatmapInput } from "./types";

export function beatmapFromOsuChart(
  chart: ParsedOsuChart,
  overallDifficulty = 8,
): ManiaBeatmapInput {
  return {
    columnCount: chart.columnCount,
    overallDifficulty,
    notes: chart.notes.map((n) => ({
      column: n.column,
      startMs: n.startMs,
      endMs: n.endMs,
    })),
  };
}

export function isEmptyBeatmap(beatmap: ManiaBeatmapInput): boolean {
  return beatmap.notes.length === 0;
}
