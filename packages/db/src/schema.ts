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
});

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
