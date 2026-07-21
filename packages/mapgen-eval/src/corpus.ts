import type { ChartNote } from "../../osu-chart/src/index";
import { bucketFor } from "./score";
import type { CorpusChartRow, MarkovTransitionTable } from "./types";

export function groupNotesByStart(notes: ChartNote[]): Array<{ timeMs: number; notes: ChartNote[] }> {
  const grouped = new Map<number, ChartNote[]>();
  for (const note of notes) {
    const bucket = grouped.get(note.startMs);
    if (bucket) bucket.push(note);
    else grouped.set(note.startMs, [note]);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timeMs, group]) => ({
      timeMs,
      notes: [...group].sort((a, b) => a.column - b.column || a.endMs - b.endMs),
    }));
}

export function encodeColumnEvent(notes: ChartNote[]): string {
  const suffix = notes.some((note) => note.endMs > note.startMs) ? "ln" : "tap";
  return `${notes.map((note) => note.column).join("+")}:${suffix}`;
}

export function buildMarkovTransitionTable(
  charts: CorpusChartRow[],
  order = 3,
): MarkovTransitionTable {
  const transitions = new Map<string, Map<string, number>>();

  for (const row of charts) {
    const bucket = bucketFor(row.starRating, row.bpm);
    const grouped = groupNotesByStart(row.chart.notes);
    const events = grouped.map((group) => encodeColumnEvent(group.notes));
    for (let i = order; i < events.length; i += 1) {
      const history = events.slice(i - order, i).join("|");
      const next = events[i]!;
      const key = `${bucket.bpmBand}__${bucket.starBand}__${history}`;
      const counts = transitions.get(key) ?? new Map<string, number>();
      counts.set(next, (counts.get(next) ?? 0) + 1);
      transitions.set(key, counts);
    }
  }

  return {
    order,
    generatedAt: new Date().toISOString(),
    transitions: [...transitions.entries()].map(([key, nextCounts]) => {
      const [bpmBand, starBand, history] = key.split("__");
      return {
        bpmBand: bpmBand ?? "120-139",
        starBand: starBand ?? "0-0.5",
        history: history ?? "",
        next: [...nextCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([event, count]) => ({ event, count })),
      };
    }),
  };
}
