import { OsuFileParser } from "@roxysu/osu-chart/parser";

export type ModsFlags = {
  invert: boolean;
  holdOff: boolean;
  mirror: boolean;
};

export type ParsedManiaChart = {
  columnCount: number;
  notes: Array<{ column: number; startMs: number; endMs: number }>;
};

export type ParseManiaResult =
  | { ok: true; chart: ParsedManiaChart }
  | { ok: false; kind: "not-mania" | "parse-error" };

/** Pattern-conversion flags from lazer mod acronyms (IN / HO / MR). */
export function modsFlagsFromAcronyms(
  acronyms: readonly string[] | null | undefined,
): ModsFlags {
  const set = new Set(acronyms ?? []);
  return {
    invert: set.has("IN"),
    holdOff: set.has("HO"),
    mirror: set.has("MR"),
  };
}

/**
 * Parse a mania `.osu` text into painter notes, mirroring the client app's
 * preview route: Invert then Hold Off conversions, Mirror flips columns after.
 */
export function parseManiaNotes(
  osuText: string,
  flags: ModsFlags,
): ParseManiaResult {
  let parser: OsuFileParser;
  try {
    parser = new OsuFileParser(osuText);
    parser.process();
  } catch {
    return { ok: false, kind: "parse-error" };
  }

  if (parser.status === "Fail") return { ok: false, kind: "parse-error" };
  if (parser.gameMode !== "3") return { ok: false, kind: "not-mania" };
  if (parser.columnCount <= 0) return { ok: false, kind: "parse-error" };

  try {
    if (flags.invert) parser.modIN();
    if (flags.holdOff) parser.modHO();
  } catch {
    return { ok: false, kind: "parse-error" };
  }

  const notes: ParsedManiaChart["notes"] = [];
  for (let i = 0; i < parser.noteStarts.length; i += 1) {
    const column = flags.mirror
      ? parser.columnCount - 1 - parser.columns[i]!
      : parser.columns[i]!;
    notes.push({
      column,
      startMs: parser.noteStarts[i]!,
      endMs: parser.noteEnds[i]!,
    });
  }
  notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);

  return {
    ok: true,
    chart: { columnCount: parser.columnCount, notes },
  };
}
