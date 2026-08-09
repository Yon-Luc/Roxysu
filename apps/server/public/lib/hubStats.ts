import type { OnlineBeatmapSet } from "./api";

export type HubRuleset = "osu" | "taiko" | "fruits" | "mania";

export type HubCollectionPlayStats = {
  starsMin: number | null;
  starsMax: number | null;
  dominantMode: HubRuleset | null;
  dominantKeys: number | null;
};

const MODE_NAMES = new Set<string>(["osu", "taiko", "fruits", "mania"]);

function asRuleset(mode: string): HubRuleset {
  return MODE_NAMES.has(mode) ? (mode as HubRuleset) : "osu";
}

/** Build hub collection stats from resolved beatmapset cards. */
export function computeHubCollectionStats(
  sets: OnlineBeatmapSet[],
): HubCollectionPlayStats {
  let starsMin: number | null = null;
  let starsMax: number | null = null;
  const modeCounts = new Map<HubRuleset, number>();
  const keyCounts = new Map<number, number>();

  for (const set of sets) {
    for (const diff of set.beatmaps) {
      if (!(diff.stars > 0)) continue;
      starsMin =
        starsMin == null ? diff.stars : Math.min(starsMin, diff.stars);
      starsMax =
        starsMax == null ? diff.stars : Math.max(starsMax, diff.stars);
      const mode = asRuleset(diff.mode);
      modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
      if (mode === "mania" && diff.keys != null && diff.keys > 0) {
        keyCounts.set(diff.keys, (keyCounts.get(diff.keys) ?? 0) + 1);
      }
    }
  }

  let dominantMode: HubRuleset | null = null;
  let bestMode = 0;
  for (const [mode, count] of modeCounts) {
    if (count > bestMode) {
      dominantMode = mode;
      bestMode = count;
    }
  }

  let dominantKeys: number | null = null;
  if (dominantMode === "mania" && keyCounts.size > 0) {
    let bestKeys = 0;
    for (const [keys, count] of keyCounts) {
      if (count > bestKeys) {
        dominantKeys = keys;
        bestKeys = count;
      }
    }
  }

  return { starsMin, starsMax, dominantMode, dominantKeys };
}

export function formatHubStarsRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (Math.abs(min - max) < 0.005) return `${min.toFixed(2)}★`;
    return `${min.toFixed(2)}★–${max.toFixed(2)}★`;
  }
  const v = min ?? max;
  return v != null ? `${v.toFixed(2)}★` : null;
}

export function formatHubDominantMode(
  mode: string | null | undefined,
  keys: number | null | undefined,
): string | null {
  if (!mode) return null;
  if (mode === "mania" && keys != null && keys > 0) {
    return `mania · ${keys}K`;
  }
  return mode;
}
