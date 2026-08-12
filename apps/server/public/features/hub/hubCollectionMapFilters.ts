import type { OnlineBeatmapSet } from "../../lib/api";
import type { HubModeTag } from "../../lib/hub";

export type MapOwnershipFilter = "all" | "missing" | "owned";
export type MapSort =
  | "stars_desc"
  | "stars_asc"
  | "name_asc"
  | "name_desc"
  | "ranked_desc"
  | "collection";

export type HubCollectionMapFilterState = {
  q: string;
  ownership: MapOwnershipFilter;
  mode: HubModeTag | "all";
  keys: number | null;
  minStars: string;
  maxStars: string;
  sort: MapSort;
};

export const DEFAULT_MAP_FILTERS: HubCollectionMapFilterState = {
  q: "",
  ownership: "all",
  mode: "all",
  keys: null,
  minStars: "",
  maxStars: "",
  sort: "stars_desc",
};

/** True when any filter normally tucked under “More filters” is active. */
export function hasAdvancedMapFilters(
  filters: HubCollectionMapFilterState,
): boolean {
  return (
    filters.ownership !== "all" ||
    filters.mode !== "all" ||
    filters.keys != null ||
    filters.minStars.trim() !== "" ||
    filters.maxStars.trim() !== ""
  );
}

const MODE_TAG_TO_RULESET: Record<HubModeTag, string> = {
  std: "osu",
  taiko: "taiko",
  ctb: "fruits",
  mania: "mania",
};

export function setMaxStars(set: OnlineBeatmapSet | undefined): number | null {
  if (!set || set.beatmaps.length === 0) return null;
  let max: number | null = null;
  for (const diff of set.beatmaps) {
    if (!(diff.stars > 0)) continue;
    max = max == null ? diff.stars : Math.max(max, diff.stars);
  }
  return max;
}

export function setHasMode(
  set: OnlineBeatmapSet | undefined,
  mode: HubModeTag,
): boolean {
  if (!set) return false;
  const ruleset = MODE_TAG_TO_RULESET[mode];
  return set.beatmaps.some((d) => d.mode === ruleset);
}

export function setHasKeys(
  set: OnlineBeatmapSet | undefined,
  keys: number,
): boolean {
  if (!set) return false;
  return set.beatmaps.some((d) => d.keys === keys);
}

export function collectPackKeys(sets: OnlineBeatmapSet[]): number[] {
  const keys = new Set<number>();
  for (const set of sets) {
    for (const diff of set.beatmaps) {
      if (diff.keys != null && diff.keys > 0) keys.add(diff.keys);
    }
  }
  return [...keys].sort((a, b) => a - b);
}

export function displayName(
  set: OnlineBeatmapSet | undefined,
  mapName: string,
  setId: number,
): string {
  if (set?.title) return set.title;
  if (mapName) return mapName;
  return `Set ${setId}`;
}

function parseStarBound(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function matchesNameQuery(
  set: OnlineBeatmapSet | undefined,
  mapName: string,
  setId: number,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    set?.title,
    set?.artist,
    set?.creator,
    mapName,
    String(setId),
    `#${setId}`,
  ];
  return haystacks.some((h) => h != null && h.toLowerCase().includes(needle));
}

export type FilterableMapRow = {
  setId: number;
  mapName: string;
  set: OnlineBeatmapSet | undefined;
  owned: boolean;
  collectionIndex: number;
};

export function filterAndSortCollectionMaps(
  rows: FilterableMapRow[],
  filters: HubCollectionMapFilterState,
): FilterableMapRow[] {
  const minStars = parseStarBound(filters.minStars);
  const maxStars = parseStarBound(filters.maxStars);
  const needsMeta =
    filters.mode !== "all" ||
    filters.keys != null ||
    minStars != null ||
    maxStars != null;

  const filtered = rows.filter((row) => {
    if (!matchesNameQuery(row.set, row.mapName, row.setId, filters.q)) {
      return false;
    }
    if (filters.ownership === "missing" && row.owned) return false;
    if (filters.ownership === "owned" && !row.owned) return false;

    if (needsMeta && !row.set) return false;

    if (filters.mode !== "all" && !setHasMode(row.set, filters.mode)) {
      return false;
    }
    if (filters.keys != null && !setHasKeys(row.set, filters.keys)) {
      return false;
    }

    if (minStars != null || maxStars != null) {
      const stars = setMaxStars(row.set);
      if (stars == null) return false;
      if (minStars != null && stars < minStars) return false;
      if (maxStars != null && stars > maxStars) return false;
    }

    return true;
  });

  if (filters.sort === "collection") return filtered;

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case "stars_desc":
      case "stars_asc": {
        const sa = setMaxStars(a.set);
        const sb = setMaxStars(b.set);
        if (sa == null && sb == null) {
          return a.collectionIndex - b.collectionIndex;
        }
        if (sa == null) return 1;
        if (sb == null) return -1;
        const cmp = filters.sort === "stars_desc" ? sb - sa : sa - sb;
        return cmp !== 0 ? cmp : a.collectionIndex - b.collectionIndex;
      }
      case "name_asc":
      case "name_desc": {
        const na = displayName(a.set, a.mapName, a.setId).toLowerCase();
        const nb = displayName(b.set, b.mapName, b.setId).toLowerCase();
        const cmp = na.localeCompare(nb);
        const dir = filters.sort === "name_asc" ? cmp : -cmp;
        return dir !== 0 ? dir : a.collectionIndex - b.collectionIndex;
      }
      case "ranked_desc": {
        const ra = a.set?.rankedDate ? Date.parse(a.set.rankedDate) : NaN;
        const rb = b.set?.rankedDate ? Date.parse(b.set.rankedDate) : NaN;
        const aOk = Number.isFinite(ra);
        const bOk = Number.isFinite(rb);
        if (!aOk && !bOk) return a.collectionIndex - b.collectionIndex;
        if (!aOk) return 1;
        if (!bOk) return -1;
        const cmp = rb - ra;
        return cmp !== 0 ? cmp : a.collectionIndex - b.collectionIndex;
      }
      default:
        return a.collectionIndex - b.collectionIndex;
    }
  });
  return sorted;
}
