import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Raw import tables — written only by realm-reader
// ---------------------------------------------------------------------------

export const rulesets = sqliteTable(
  "rulesets",
  {
    shortName: text("short_name").primaryKey(),
    onlineId: integer("online_id").notNull(),
    name: text("name"),
    available: integer("available", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    onlineIdIdx: index("rulesets_online_id_idx").on(t.onlineId),
  }),
);

export const beatmapSets = sqliteTable(
  "beatmap_sets",
  {
    id: text("id").primaryKey(),
    onlineId: integer("online_id").notNull(),
    dateAdded: integer("date_added", { mode: "timestamp_ms" }).notNull(),
    dateSubmitted: integer("date_submitted", { mode: "timestamp_ms" }),
    dateRanked: integer("date_ranked", { mode: "timestamp_ms" }),
    status: integer("status").notNull(),
    deletePending: integer("delete_pending", { mode: "boolean" })
      .notNull()
      .default(false),
    hash: text("hash"),
    protected: integer("protected", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    onlineIdIdx: index("beatmap_sets_online_id_idx").on(t.onlineId),
  }),
);

export const beatmaps = sqliteTable(
  "beatmaps",
  {
    id: text("id").primaryKey(),
    onlineId: integer("online_id").notNull(),
    setId: text("set_id")
      .notNull()
      .references(() => beatmapSets.id),
    difficultyName: text("difficulty_name"),
    rulesetShortName: text("ruleset_short_name"),
    status: integer("status").notNull(),
    length: real("length").notNull(),
    bpm: real("bpm").notNull(),
    starRating: real("star_rating").notNull(),
    md5Hash: text("md5_hash"),
    hash: text("hash"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    totalObjectCount: integer("total_object_count").notNull().default(0),
    endTimeObjectCount: integer("end_time_object_count").notNull().default(0),
    lastPlayed: integer("last_played", { mode: "timestamp_ms" }),

    // Difficulty (embedded)
    drainRate: real("drain_rate"),
    circleSize: real("circle_size"),
    overallDifficulty: real("overall_difficulty"),
    approachRate: real("approach_rate"),
    sliderMultiplier: real("slider_multiplier"),
    sliderTickRate: real("slider_tick_rate"),

    // Metadata (flattened)
    title: text("title"),
    titleUnicode: text("title_unicode"),
    artist: text("artist"),
    artistUnicode: text("artist_unicode"),
    source: text("source"),
    tags: text("tags"),
    previewTime: integer("preview_time"),
    audioFile: text("audio_file"),
    /** SHA-256 of the audio file in lazer's hashed files/ store. */
    audioFileHash: text("audio_file_hash"),
    backgroundFile: text("background_file"),
    /** SHA-256 of the background file in lazer's hashed files/ store. */
    backgroundFileHash: text("background_file_hash"),
    mapperOnlineId: integer("mapper_online_id"),
    mapperUsername: text("mapper_username"),

    offset: real("offset"),
    lastLocalUpdate: integer("last_local_update", { mode: "timestamp_ms" }),
    lastOnlineUpdate: integer("last_online_update", { mode: "timestamp_ms" }),
  },
  (t) => ({
    onlineIdIdx: index("beatmaps_online_id_idx").on(t.onlineId),
    md5HashIdx: index("beatmaps_md5_hash_idx").on(t.md5Hash),
    setIdIdx: index("beatmaps_set_id_idx").on(t.setId),
  }),
);

export const scores = sqliteTable(
  "scores",
  {
    id: text("id").primaryKey(),
    onlineId: integer("online_id").notNull(),
    legacyOnlineId: integer("legacy_online_id").notNull(),
    beatmapId: text("beatmap_id").references(() => beatmaps.id),
    beatmapHash: text("beatmap_hash"),
    rulesetShortName: text("ruleset_short_name"),
    clientVersion: text("client_version"),
    totalScore: integer("total_score").notNull().default(0),
    totalScoreWithoutMods: integer("total_score_without_mods").notNull().default(0),
    legacyTotalScore: integer("legacy_total_score"),
    maxCombo: integer("max_combo").notNull().default(0),
    combo: integer("combo").notNull().default(0),
    accuracy: real("accuracy").notNull().default(0),
    pp: real("pp"),
    rank: integer("rank").notNull().default(0),
    mods: text("mods"),
    statistics: text("statistics"),
    maximumStatistics: text("maximum_statistics"),
    playedAt: integer("played_at", { mode: "timestamp_ms" }).notNull(),
    userOnlineId: integer("user_online_id"),
    userUsername: text("user_username"),
    isLegacyScore: integer("is_legacy_score", { mode: "boolean" })
      .notNull()
      .default(false),
    deletePending: integer("delete_pending", { mode: "boolean" })
      .notNull()
      .default(false),
    hash: text("hash"),
    /** SHA-256 of the local lazer replay blob (Score.Files), when present. */
    replayFileHash: text("replay_file_hash"),
  },
  (t) => ({
    onlineIdIdx: index("scores_online_id_idx").on(t.onlineId),
    legacyOnlineIdIdx: index("scores_legacy_online_id_idx").on(t.legacyOnlineId),
    beatmapIdIdx: index("scores_beatmap_id_idx").on(t.beatmapId),
    playedAtIdx: index("scores_played_at_idx").on(t.playedAt),
  }),
);

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", {
    enum: ["full", "incremental", "reconcile"],
  }).notNull(),
  status: text("status", {
    enum: ["running", "success", "failed", "locked"],
  }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  realmSchemaVersion: integer("realm_schema_version").notNull(),
  beatmapSetsUpserted: integer("beatmap_sets_upserted").notNull().default(0),
  beatmapsUpserted: integer("beatmaps_upserted").notNull().default(0),
  scoresUpserted: integer("scores_upserted").notNull().default(0),
  /** Rows actually inserted/updated (excludes no-op conflict updates). */
  rowsChanged: integer("rows_changed").notNull().default(0),
  scoresDeleted: integer("scores_deleted").notNull().default(0),
  beatmapsDeleted: integer("beatmaps_deleted").notNull().default(0),
  beatmapSetsDeleted: integer("beatmap_sets_deleted").notNull().default(0),
  /**
   * JSON string[] of score IDs touched by this import, or null when analytics
   * should do a full rebuild (bootstrap / large full sync).
   */
  changedScoreIds: text("changed_score_ids"),
  /**
   * JSON string[] of beatmap IDs touched by this import, or null for full rebuild.
   */
  changedBeatmapIds: text("changed_beatmap_ids"),
  error: text("error"),
});

// ---------------------------------------------------------------------------
// Derived / user tables — written only by server
// ---------------------------------------------------------------------------

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  scoreCount: integer("score_count").notNull().default(0),
  rulesetShortName: text("ruleset_short_name"),
});

export const mastery = sqliteTable("mastery", {
  beatmapId: text("beatmap_id")
    .primaryKey()
    .references(() => beatmaps.id),
  level: real("level").notNull().default(0),
  playCount: integer("play_count").notNull().default(0),
  bestAccuracy: real("best_accuracy"),
  bestPp: real("best_pp"),
  lastPlayedAt: integer("last_played_at", { mode: "timestamp_ms" }),
  formulaId: text("formula_id").notNull().default("simple"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  query: text("query").notNull(),
  lazerCollectionId: text("lazer_collection_id"),
  lazerSyncedAt: integer("lazer_synced_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  /**
   * Cached result of countMatches(query). NULL means "not yet computed".
   * Updated lazily whenever the collection is saved or after a sync event.
   */
  cachedMatchCount: integer("cached_match_count"),
});

/**
 * Hub collections the user saved into the local game (`!Roxysu …` in lazer).
 * Tracks hub `updatedAt` so we can offer an Update when the creator changes it.
 */
export const hubAddedCollections = sqliteTable("hub_added_collections", {
  hubCollectionId: integer("hub_collection_id").primaryKey(),
  name: text("name").notNull(),
  /** JSON number[] of beatmapset online IDs from the hub export. */
  beatmapsetIdsJson: text("beatmapset_ids_json").notNull().default("[]"),
  /** Hub collection `updatedAt` at last save/update (ms). */
  hubUpdatedAt: integer("hub_updated_at", { mode: "timestamp_ms" }).notNull(),
  lazerCollectionId: text("lazer_collection_id"),
  lazerSyncedAt: integer("lazer_synced_at", { mode: "timestamp_ms" }),
  addedAt: integer("added_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Mirrored from lazer BeatmapCollection (realm-reader owned). */
export const realmCollections = sqliteTable("realm_collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastModified: integer("last_modified", { mode: "timestamp_ms" }),
  hashCount: integer("hash_count").notNull().default(0),
  resolvedSetCount: integer("resolved_set_count").notNull().default(0),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
});

export const realmCollectionHashes = sqliteTable(
  "realm_collection_hashes",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => realmCollections.id, { onDelete: "cascade" }),
    md5Hash: text("md5_hash").notNull(),
    beatmapsetOnlineId: integer("beatmapset_online_id"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.md5Hash] }),
    md5Idx: index("realm_collection_hashes_md5_idx").on(t.md5Hash),
  }),
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color"),
});

export const beatmapTags = sqliteTable(
  "beatmap_tags",
  {
    beatmapId: text("beatmap_id")
      .notNull()
      .references(() => beatmaps.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.beatmapId, t.tagId] }),
  }),
);

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  beatmapId: text("beatmap_id")
    .notNull()
    .references(() => beatmaps.id),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const dailyStats = sqliteTable("daily_stats", {
  day: text("day").primaryKey(),
  playCount: integer("play_count").notNull().default(0),
  totalPp: real("total_pp").notNull().default(0),
  avgAccuracy: real("avg_accuracy"),
});

export const weeklyStats = sqliteTable("weekly_stats", {
  weekStart: text("week_start").primaryKey(),
  playCount: integer("play_count").notNull().default(0),
  totalPp: real("total_pp").notNull().default(0),
  avgAccuracy: real("avg_accuracy"),
});

export const mapperStats = sqliteTable("mapper_stats", {
  mapperOnlineId: integer("mapper_online_id").primaryKey(),
  mapperUsername: text("mapper_username"),
  playCount: integer("play_count").notNull().default(0),
  totalPp: real("total_pp").notNull().default(0),
  avgAccuracy: real("avg_accuracy"),
});

export const scoreMetrics = sqliteTable("score_metrics", {
  scoreId: text("score_id")
    .primaryKey()
    .references(() => scores.id),
  retryIndex: integer("retry_index"),
  isPb: integer("is_pb", { mode: "boolean" }).notNull().default(false),
  sessionId: integer("session_id").references(() => sessions.id),
});

/**
 * Cached map-analysis results (e.g. Sunny → dan estimate).
 * Written only by server; keyed by beatmap + algorithm.
 */
export const beatmapDanRatings = sqliteTable(
  "beatmap_dan_ratings",
  {
    beatmapId: text("beatmap_id")
      .notNull()
      .references(() => beatmaps.id),
    /** Estimator id, e.g. "sunny". */
    algorithm: text("algorithm").notNull(),
    /** Beatmap content hash when computed (invalidate on mismatch). */
    beatmapHash: text("beatmap_hash"),
    sunnyStar: real("sunny_star"),
    lnRatio: real("ln_ratio"),
    columnCount: integer("column_count"),
    /** Human-readable dan label, e.g. "Reform 5 mid" or "Regular 7 high". */
    estDiff: text("est_diff"),
    error: text("error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.beatmapId, t.algorithm] }),
  }),
);

/**
 * Cached 7k dominant-pattern analysis (heuristic over parsed chart notes).
 * Written only by server; keyed by beatmap + algorithm.
 */
/**
 * Cached mania SR / SS PP from versioned calculator binaries (Rating Lab).
 * Written only by server; keyed by beatmap + version_id.
 */
export const beatmapManiaRatings = sqliteTable(
  "beatmap_mania_ratings",
  {
    beatmapId: text("beatmap_id")
      .notNull()
      .references(() => beatmaps.id),
    /** Formula version id, e.g. "lazer-master", "enissay-accuracy-change". */
    versionId: text("version_id").notNull(),
    beatmapHash: text("beatmap_hash"),
    starRating: real("star_rating"),
    starRatingSs: real("star_rating_ss"),
    ppSs: real("pp_ss"),
    /** JSON map of custom-accuracy % → PP, e.g. {"100":412.5,"99.5":400,…}. */
    ppByAccuracyJson: text("pp_by_accuracy_json"),
    attributesJson: text("attributes_json"),
    error: text("error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.beatmapId, t.versionId] }),
    versionIdx: index("beatmap_mania_ratings_version_idx").on(t.versionId),
  }),
);

export const beatmapPatternAnalysis = sqliteTable(
  "beatmap_pattern_analysis",
  {
    beatmapId: text("beatmap_id")
      .notNull()
      .references(() => beatmaps.id),
    /** Analyzer id, e.g. "7k-heuristic-v1". */
    algorithm: text("algorithm").notNull(),
    beatmapHash: text("beatmap_hash"),
    columnCount: integer("column_count"),
    dominantPattern: text("dominant_pattern"),
    secondaryPattern: text("secondary_pattern"),
    confidence: real("confidence"),
    jackDensity: real("jack_density"),
    chordDensity: real("chord_density"),
    streamDensity: real("stream_density"),
    bracketDensity: real("bracket_density"),
    chordjackScore: real("chordjack_score"),
    jumpstreamScore: real("jumpstream_score"),
    chordstreamScore: real("chordstream_score"),
    error: text("error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.beatmapId, t.algorithm] }),
  }),
);
