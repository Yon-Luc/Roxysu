import { isHold, parse7kChart } from "../integrations/osu-chart";
import { NoteType, createBeatmapChart, type BeatmapChart } from "./BeatmapChart";

export type BeatmapParseError =
  | { kind: "invalid_syntax"; message: string }
  | { kind: "unsupported_ruleset"; message: string }
  | { kind: "unsupported_keys"; message: string }
  | { kind: "empty_chart"; message: string };

export function parseBeatmapChart(
  osuText: string,
  overallDifficulty = 8,
): BeatmapChart | BeatmapParseError {
  let parsed;
  try {
    parsed = parse7kChart(osuText);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Beatmap parse failed";
    if (message.includes("not mania")) {
      return { kind: "unsupported_ruleset", message };
    }
    if (message.includes("7k")) {
      return { kind: "unsupported_keys", message };
    }
    return { kind: "invalid_syntax", message };
  }

  if (parsed.notes.length === 0) {
    return { kind: "empty_chart", message: "Beatmap contains no notes" };
  }

  const count = parsed.notes.length;
  const column = new Uint8Array(count);
  const startMs = new Float64Array(count);
  const endMs = new Float64Array(count);
  const type = new Uint8Array(count);

  for (let i = 0; i < count; i += 1) {
    const note = parsed.notes[i]!;
    column[i] = note.column;
    startMs[i] = note.startMs;
    endMs[i] = note.endMs;
    type[i] = isHold(note) ? NoteType.Hold : NoteType.Tap;
  }

  return createBeatmapChart({
    columnCount: parsed.columnCount,
    overallDifficulty,
    column,
    startMs,
    endMs,
    type,
  });
}
