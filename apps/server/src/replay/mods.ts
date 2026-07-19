export type ModAcronyms = {
  acronyms: string[];
  rate: number;
  mirror: boolean;
  easy: boolean;
  hardRock: boolean;
};

/** Parse lazer score `mods` JSON into playback helpers. */
export function parseScoreMods(mods: string | null | undefined): ModAcronyms {
  const acronyms: string[] = [];
  if (mods && mods !== "[]" && mods !== "{}") {
    try {
      const parsed = JSON.parse(mods) as unknown;
      if (Array.isArray(parsed)) {
        for (const m of parsed) {
          if (typeof m === "string") acronyms.push(m.toUpperCase());
          else if (m && typeof m === "object" && "acronym" in m) {
            acronyms.push(String((m as { acronym: string }).acronym).toUpperCase());
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const set = new Set(acronyms);
  let rate = 1;
  if (set.has("DT") || set.has("NC")) rate = 1.5;
  else if (set.has("HT") || set.has("DC")) rate = 0.75;

  return {
    acronyms,
    rate,
    mirror: set.has("MR"),
    easy: set.has("EZ"),
    hardRock: set.has("HR"),
  };
}

export function adjustOverallDifficulty(
  od: number,
  mods: ModAcronyms,
): number {
  let next = od;
  if (mods.hardRock) next = Math.min(10, next * 1.4);
  if (mods.easy) next = next * 0.5;
  return next;
}
