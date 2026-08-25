export {
  parseScoreMods,
  isNomodOrMirrorOnly,
  adjustOverallDifficulty,
  scaleManiaHitWindows,
  formatModAcronym,
  parseModEntries,
  readSpeedChange,
  defaultRateForAcronym,
  resolveDanVariant,
  danVariantKey,
  type ModAcronyms,
  type DanVariant,
} from "@roxysu/mania-judge/mods";

/** Pattern-conversion mods supported by beatmap preview / score rewatch. */
const PATTERN_MOD_QUERY = new Set(["MR", "IN", "HO"]);

export type PatternModQuery = {
  acronyms: string[];
  mirror: boolean;
  invert: boolean;
  holdOff: boolean;
};

/**
 * Parse a comma-separated lazer acronym list (e.g. `"DT,IN"`) down to the
 * pattern conversions preview/rewatch can render. Unknown acronyms are dropped.
 */
export function parsePatternModQuery(
  raw: string | null | undefined,
): PatternModQuery {
  const acronyms = (raw ?? "")
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter((a) => PATTERN_MOD_QUERY.has(a));
  const set = new Set(acronyms);
  return {
    acronyms,
    mirror: set.has("MR"),
    invert: set.has("IN"),
    holdOff: set.has("HO"),
  };
}
