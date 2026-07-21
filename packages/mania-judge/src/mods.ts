export type ModAcronyms = {
  acronyms: string[];
  rate: number;
  mirror: boolean;
  easy: boolean;
  hardRock: boolean;
};

type LazerModEntry = {
  acronym?: string;
  settings?: Record<string, unknown>;
};

const RATE_UP_MODS = new Set(["DT", "NC"]);
const RATE_DOWN_MODS = new Set(["HT", "DC"]);
const DEFAULT_RATE_UP = 1.5;
const DEFAULT_RATE_DOWN = 0.75;

function readSpeedChange(
  settings: Record<string, unknown> | undefined,
): number | null {
  if (!settings) return null;
  const raw = settings.speed_change ?? settings.speedChange;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function defaultRateForAcronym(acronym: string): number | null {
  if (RATE_UP_MODS.has(acronym)) return DEFAULT_RATE_UP;
  if (RATE_DOWN_MODS.has(acronym)) return DEFAULT_RATE_DOWN;
  return null;
}

function parseModEntries(mods: string | null | undefined): LazerModEntry[] {
  if (!mods || mods === "[]" || mods === "{}") return [];
  try {
    const parsed = JSON.parse(mods) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: LazerModEntry[] = [];
    for (const m of parsed) {
      if (typeof m === "string") {
        entries.push({ acronym: m.toUpperCase() });
      } else if (m && typeof m === "object" && "acronym" in m) {
        const entry = m as LazerModEntry;
        entries.push({
          acronym: String(entry.acronym).toUpperCase(),
          settings:
            entry.settings && typeof entry.settings === "object"
              ? entry.settings
              : undefined,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Parse lazer score `mods` JSON into playback helpers. */
export function parseScoreMods(mods: string | null | undefined): ModAcronyms {
  const entries = parseModEntries(mods);
  const acronyms = entries
    .map((m) => m.acronym)
    .filter((a): a is string => Boolean(a));
  const set = new Set(acronyms);

  let rate = 1;
  for (const entry of entries) {
    const acronym = entry.acronym;
    if (!acronym) continue;
    const defaultRate = defaultRateForAcronym(acronym);
    if (defaultRate == null) continue;
    rate = readSpeedChange(entry.settings) ?? defaultRate;
    break;
  }

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

/**
 * Scale mania hit windows for a playback rate mod.
 * Matches lazer mania: windows grow/shrink in map-time so real-world len stays stable.
 */
export function scaleManiaHitWindows<T extends Record<string, number>>(
  windows: T,
  rate: number,
): T {
  if (rate === 1) return windows;
  const scale = (n: number) => Math.floor(n * rate) + 0.5;
  const next = { ...windows };
  for (const key of Object.keys(next)) {
    next[key] = scale(next[key]!);
  }
  return next;
}

/** Format a mod acronym; custom rate mods become `X1.15` instead of the mod name. */
export function formatModAcronym(entry: LazerModEntry): string {
  const acronym = entry.acronym ?? "?";
  const defaultRate = defaultRateForAcronym(acronym);
  const speed = readSpeedChange(entry.settings);
  if (
    defaultRate != null &&
    speed != null &&
    Math.abs(speed - defaultRate) > 0.001
  ) {
    const label = speed.toFixed(2).replace(/\.?0+$/, "");
    return `X${label}`;
  }
  return acronym;
}

export { parseModEntries, readSpeedChange, defaultRateForAcronym };
