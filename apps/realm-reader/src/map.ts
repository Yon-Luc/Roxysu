import type {
  beatmapSets,
  beatmaps,
  rulesets,
  scores,
} from "@roxysu/db/schema";

export type RulesetRow = typeof rulesets.$inferInsert;
export type BeatmapSetRow = typeof beatmapSets.$inferInsert;
export type BeatmapRow = typeof beatmaps.$inferInsert;
export type ScoreRow = typeof scores.$inferInsert;

/** Loose Realm object — properties match osu-client.schema.json. */
// Realm JS returns dynamic objects; keep access untyped at the boundary.
type RealmObj = Record<string, any>;

function uuidString(value: unknown): string {
  if (value == null) throw new Error("expected uuid");
  return String(value);
}

function optionalUuid(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  return new Date(value as string | number);
}

function requireDate(value: unknown, fallback = new Date(0)): Date {
  return toDate(value) ?? fallback;
}

export function mapRuleset(obj: RealmObj): RulesetRow | null {
  const shortName = obj.ShortName as string | null | undefined;
  if (!shortName) return null;
  return {
    shortName,
    onlineId: Number(obj.OnlineID ?? -1),
    name: (obj.Name as string | null) ?? null,
    available: Boolean(obj.Available),
  };
}

export function mapBeatmapSet(obj: RealmObj): BeatmapSetRow | null {
  return {
    id: uuidString(obj.ID),
    onlineId: Number(obj.OnlineID ?? 0),
    dateAdded: requireDate(obj.DateAdded),
    dateSubmitted: toDate(obj.DateSubmitted),
    dateRanked: toDate(obj.DateRanked),
    status: Number(obj.Status ?? 0),
    deletePending: Boolean(obj.DeletePending),
    hash: (obj.Hash as string | null) ?? null,
    protected: Boolean(obj.Protected),
  };
}

export function mapBeatmap(obj: RealmObj): BeatmapRow | null {
  const set = obj.BeatmapSet as RealmObj | null | undefined;
  if (!set?.ID) return null;

  const difficulty = obj.Difficulty as RealmObj | null | undefined;
  const metadata = obj.Metadata as RealmObj | null | undefined;
  const author = metadata?.Author as RealmObj | null | undefined;
  const userSettings = obj.UserSettings as RealmObj | null | undefined;
  const ruleset = obj.Ruleset as RealmObj | null | undefined;

  return {
    id: uuidString(obj.ID),
    onlineId: Number(obj.OnlineID ?? 0),
    setId: uuidString(set.ID),
    difficultyName: (obj.DifficultyName as string | null) ?? null,
    rulesetShortName: (ruleset?.ShortName as string | null) ?? null,
    status: Number(obj.Status ?? 0),
    length: Number(obj.Length ?? 0),
    bpm: Number(obj.BPM ?? 0),
    starRating: Number(obj.StarRating ?? 0),
    md5Hash: (obj.MD5Hash as string | null) ?? null,
    hash: (obj.Hash as string | null) ?? null,
    hidden: Boolean(obj.Hidden),
    totalObjectCount: Number(obj.TotalObjectCount ?? 0),
    endTimeObjectCount: Number(obj.EndTimeObjectCount ?? 0),
    lastPlayed: toDate(obj.LastPlayed),

    drainRate: difficulty != null ? Number(difficulty.DrainRate) : null,
    circleSize: difficulty != null ? Number(difficulty.CircleSize) : null,
    overallDifficulty:
      difficulty != null ? Number(difficulty.OverallDifficulty) : null,
    approachRate: difficulty != null ? Number(difficulty.ApproachRate) : null,
    sliderMultiplier:
      difficulty != null ? Number(difficulty.SliderMultiplier) : null,
    sliderTickRate:
      difficulty != null ? Number(difficulty.SliderTickRate) : null,

    title: (metadata?.Title as string | null) ?? null,
    titleUnicode: (metadata?.TitleUnicode as string | null) ?? null,
    artist: (metadata?.Artist as string | null) ?? null,
    artistUnicode: (metadata?.ArtistUnicode as string | null) ?? null,
    source: (metadata?.Source as string | null) ?? null,
    tags: (metadata?.Tags as string | null) ?? null,
    previewTime:
      metadata?.PreviewTime != null ? Number(metadata.PreviewTime) : null,
    audioFile: (metadata?.AudioFile as string | null) ?? null,
    backgroundFile: (metadata?.BackgroundFile as string | null) ?? null,
    mapperOnlineId: author != null ? Number(author.OnlineID ?? 0) : null,
    mapperUsername: (author?.Username as string | null) ?? null,

    offset: userSettings != null ? Number(userSettings.Offset ?? 0) : null,
    lastLocalUpdate: toDate(obj.LastLocalUpdate),
    lastOnlineUpdate: toDate(obj.LastOnlineUpdate),
  };
}

export function mapScore(obj: RealmObj): ScoreRow | null {
  const beatmap = obj.BeatmapInfo as RealmObj | null | undefined;
  const ruleset = obj.Ruleset as RealmObj | null | undefined;
  const user = obj.User as RealmObj | null | undefined;

  return {
    id: uuidString(obj.ID),
    onlineId: Number(obj.OnlineID ?? 0),
    legacyOnlineId: Number(obj.LegacyOnlineID ?? 0),
    beatmapId: optionalUuid(beatmap?.ID),
    beatmapHash: (obj.BeatmapHash as string | null) ?? null,
    rulesetShortName: (ruleset?.ShortName as string | null) ?? null,
    clientVersion: (obj.ClientVersion as string | null) ?? null,
    totalScore: Number(obj.TotalScore ?? 0),
    totalScoreWithoutMods: Number(obj.TotalScoreWithoutMods ?? 0),
    legacyTotalScore:
      obj.LegacyTotalScore != null ? Number(obj.LegacyTotalScore) : null,
    maxCombo: Number(obj.MaxCombo ?? 0),
    combo: Number(obj.Combo ?? 0),
    accuracy: Number(obj.Accuracy ?? 0),
    pp: obj.PP != null ? Number(obj.PP) : null,
    rank: Number(obj.Rank ?? 0),
    mods: (obj.Mods as string | null) ?? null,
    statistics: (obj.Statistics as string | null) ?? null,
    maximumStatistics: (obj.MaximumStatistics as string | null) ?? null,
    playedAt: requireDate(obj.Date),
    userOnlineId: user != null ? Number(user.OnlineID ?? 0) : null,
    userUsername: (user?.Username as string | null) ?? null,
    isLegacyScore: Boolean(obj.IsLegacyScore),
    deletePending: Boolean(obj.DeletePending),
    hash: (obj.Hash as string | null) ?? null,
  };
}
