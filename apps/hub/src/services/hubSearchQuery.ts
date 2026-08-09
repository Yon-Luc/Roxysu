import { isHubRuleset, type HubRuleset } from "./collectionStats";

export type HubSearchFilters = {
  /** Remaining free-text after stripping field filters. */
  text: string;
  mode: HubRuleset | null;
  keys: number | null;
  /** Collection must reach at least this star (starsMax >= min). */
  starsMin: number | null;
  /** Collection must include diffs at or below this (starsMin <= max). */
  starsMax: number | null;
};

const MODE_ALIASES: Record<string, HubRuleset> = {
  osu: "osu",
  "osu!": "osu",
  standard: "osu",
  std: "osu",
  o: "osu",
  taiko: "taiko",
  t: "taiko",
  fruits: "fruits",
  catch: "fruits",
  ctb: "fruits",
  c: "fruits",
  f: "fruits",
  mania: "mania",
  m: "mania",
};

/**
 * Parse hub browse `q` into free text + mode/key/stars filters.
 * Supported tokens: mode=m|mania|…, key=7|keys=4, stars>5, stars<=7, stars=5.5
 */
export function parseHubSearchQuery(raw: string | undefined): HubSearchFilters {
  const filters: HubSearchFilters = {
    text: "",
    mode: null,
    keys: null,
    starsMin: null,
    starsMax: null,
  };
  if (!raw?.trim()) return filters;

  const leftovers: string[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const modeMatch = /^mode=(.+)$/i.exec(token);
    if (modeMatch) {
      const alias = modeMatch[1]!.trim().toLowerCase();
      const mode = MODE_ALIASES[alias];
      if (mode && isHubRuleset(mode)) filters.mode = mode;
      continue;
    }

    const keyMatch = /^(?:key|keys)=(\d+)$/i.exec(token);
    if (keyMatch) {
      const keys = Number(keyMatch[1]);
      if (Number.isSafeInteger(keys) && keys > 0 && keys <= 18) {
        filters.keys = keys;
        if (!filters.mode) filters.mode = "mania";
      }
      continue;
    }

    const starsMatch = /^stars(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/i.exec(token);
    if (starsMatch) {
      const op = starsMatch[1]!;
      const value = Number(starsMatch[2]);
      if (!Number.isFinite(value)) continue;
      switch (op) {
        case ">":
          filters.starsMin =
            filters.starsMin == null
              ? value + 1e-6
              : Math.max(filters.starsMin, value + 1e-6);
          break;
        case ">=":
          filters.starsMin =
            filters.starsMin == null
              ? value
              : Math.max(filters.starsMin, value);
          break;
        case "<":
          filters.starsMax =
            filters.starsMax == null
              ? value - 1e-6
              : Math.min(filters.starsMax, value - 1e-6);
          break;
        case "<=":
          filters.starsMax =
            filters.starsMax == null
              ? value
              : Math.min(filters.starsMax, value);
          break;
        case "=":
          filters.starsMin =
            filters.starsMin == null
              ? value
              : Math.max(filters.starsMin, value);
          filters.starsMax =
            filters.starsMax == null
              ? value
              : Math.min(filters.starsMax, value);
          break;
      }
      continue;
    }

    leftovers.push(token);
  }

  filters.text = leftovers.join(" ").trim();
  return filters;
}
