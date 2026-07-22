/** osu!lazer BeatmapOnlineStatus integer values. */
export const BEATMAP_STATUS = {
  locallyModified: -4,
  none: -3,
  graveyard: -2,
  wip: -1,
  pending: 0,
  ranked: 1,
  approved: 2,
  qualified: 3,
  loved: 4,
} as const;

export type BeatmapStatusName = keyof typeof BEATMAP_STATUS;

const ALIASES: Record<string, BeatmapStatusName> = {
  locallymodified: "locallyModified",
  local: "locallyModified",
  modified: "locallyModified",
  none: "none",
  unknown: "none",
  notsubmitted: "none",
  n: "none",
  u: "none",
  graveyard: "graveyard",
  g: "graveyard",
  wip: "wip",
  w: "wip",
  pending: "pending",
  p: "pending",
  ranked: "ranked",
  ranking: "ranked",
  r: "ranked",
  approved: "approved",
  a: "approved",
  qualified: "qualified",
  q: "qualified",
  loved: "loved",
  l: "loved",
};

export function normalizeStatusToken(raw: string): BeatmapStatusName | null {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return null;
  return ALIASES[key] ?? null;
}

export function parseStatusList(raw: string): BeatmapStatusName[] {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("status value is empty");
  }

  const values: BeatmapStatusName[] = [];
  for (const part of parts) {
    const name = normalizeStatusToken(part);
    if (!name) {
      throw new Error(`unknown beatmap status: ${part}`);
    }
    if (!values.includes(name)) values.push(name);
  }
  return values;
}

export function statusNameToInt(name: BeatmapStatusName): number {
  return BEATMAP_STATUS[name];
}
