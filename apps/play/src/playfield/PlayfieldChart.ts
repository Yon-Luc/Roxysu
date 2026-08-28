import type { BeatmapChart } from "../beatmap/BeatmapChart";
import type { PlayfieldChart } from "./PlayfieldTypes";

export function toPlayfieldChart(chart: BeatmapChart): PlayfieldChart {
  return {
    noteCount: chart.noteCount,
    startTime: chart.startMs,
    endTime: chart.endMs,
    lane: chart.column,
    type: chart.type,
  };
}

export function createEmptyPlayfieldChart(): PlayfieldChart {
  return {
    noteCount: 0,
    startTime: new Float64Array(0),
    endTime: new Float64Array(0),
    lane: new Uint8Array(0),
    type: new Uint8Array(0),
  };
}
