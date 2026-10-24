import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Users (identity via osu! OAuth)
// ---------------------------------------------------------------------------
export const hubUsers = sqliteTable("hub_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  osuId: integer("osu_id").notNull().unique(),
  username: text("username").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  /** osu! account country code. Null when the profile did not include one. */
  countryCode: text("country_code"),
  /** Public BMS profile. Enforced on public BMS reads, not only in the UI. */
  bmsProfilePublic: integer("bms_profile_public", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type HubUser = typeof hubUsers.$inferSelect;
export type NewHubUser = typeof hubUsers.$inferInsert;

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
export const collections = sqliteTable(
  "collections",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => hubUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  downloadCount: integer("download_count").notNull().default(0),
  /** Min star rating across difficulties in the collection (nullable until computed). */
  starsMin: real("stars_min"),
  /** Max star rating across difficulties in the collection. */
  starsMax: real("stars_max"),
  /** Most common ruleset among difficulties: osu | taiko | fruits | mania. */
  dominantMode: text("dominant_mode"),
  /** Most common mania key count when dominantMode is mania. */
  dominantKeys: integer("dominant_keys"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  },
  (t) => ({
    ownerIdIdx: index("collections_owner_id_idx").on(t.ownerId),
    createdAtIdx: index("collections_created_at_idx").on(t.createdAt),
  }),
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

// ---------------------------------------------------------------------------
// Collection beatmapset entries
// ---------------------------------------------------------------------------
export const collectionMaps = sqliteTable(
  "collection_maps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    beatmapsetId: integer("beatmapset_id").notNull(),
    mapName: text("map_name").notNull().default(""),
  },
  (t) => ({
    collectionIdIdx: index("collection_maps_collection_id_idx").on(
      t.collectionId,
    ),
    collectionSetUnique: uniqueIndex("collection_maps_collection_set_unique").on(
      t.collectionId,
      t.beatmapsetId,
    ),
  }),
);

export type CollectionMap = typeof collectionMaps.$inferSelect;
export type NewCollectionMap = typeof collectionMaps.$inferInsert;

/**
 * Difficulties that belong in a shared collection.
 * One row per osu beatmap online id. Empty for a collection means legacy
 * whole-set membership (every difficulty of each set).
 */
export const collectionBeatmaps = sqliteTable(
  "collection_beatmaps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    beatmapsetId: integer("beatmapset_id").notNull(),
    beatmapId: integer("beatmap_id").notNull(),
  },
  (t) => ({
    collectionIdIdx: index("collection_beatmaps_collection_id_idx").on(
      t.collectionId,
    ),
    collectionBeatmapUnique: uniqueIndex(
      "collection_beatmaps_collection_beatmap_unique",
    ).on(t.collectionId, t.beatmapId),
  }),
);

export type CollectionBeatmap = typeof collectionBeatmaps.$inferSelect;
export type NewCollectionBeatmap = typeof collectionBeatmaps.$inferInsert;

// ---------------------------------------------------------------------------
// Collection tags
// ---------------------------------------------------------------------------
/** Primary gamemode tags shown in the hub filter row. */
export const HUB_MODE_TAGS = ["mania", "std", "ctb", "taiko"] as const;
export type HubModeTag = (typeof HUB_MODE_TAGS)[number];

/**
 * Secondary tags per primary mode, grouped under category labels for the
 * picker UI. Mode tags themselves are also valid collection tags.
 */
export const HUB_TAG_GROUPS_BY_MODE = {
  mania: [
    { label: "Keys", tags: ["4k", "5k", "6k", "7k", "8k"] },
    {
      label: "Skill",
      tags: ["speed", "jack", "coordination", "technical", "release"],
    },
    { label: "Style", tags: ["ln", "rice", "hybrid", "sv"] },
    { label: "Difficulty", tags: ["stamina", "dan", "beginner"] },
  ],
  std: [
    {
      label: "Pattern",
      tags: ["aim", "jump", "stream", "alt", "burst", "speed", "stamina"],
    },
    { label: "Style", tags: ["tech", "reading"] },
    { label: "Level", tags: ["beginner"] },
  ],
  ctb: [
    {
      label: "Pattern",
      tags: ["jump", "stream", "hyperdash", "stamina", "speed"],
    },
    { label: "Style", tags: ["tech", "anti-flow"] },
    { label: "Level", tags: ["beginner"] },
  ],
  taiko: [
    { label: "Pattern", tags: ["stream", "stamina", "speed"] },
    { label: "Style", tags: ["tech", "gimmick"] },
    { label: "Level", tags: ["beginner"] },
  ],
} as const satisfies Record<
  HubModeTag,
  readonly { label: string; tags: readonly string[] }[]
>;

/** Flat secondary tags per mode (derived from the grouped structure). */
export const HUB_TAGS_BY_MODE = {
  mania: HUB_TAG_GROUPS_BY_MODE.mania.flatMap((g) => g.tags),
  std: HUB_TAG_GROUPS_BY_MODE.std.flatMap((g) => g.tags),
  ctb: HUB_TAG_GROUPS_BY_MODE.ctb.flatMap((g) => g.tags),
  taiko: HUB_TAG_GROUPS_BY_MODE.taiko.flatMap((g) => g.tags),
} as const satisfies Record<HubModeTag, readonly string[]>;

/**
 * Retired mania pattern tags. Kept valid so shared collections created before
 * the dominant-skill switch keep validating; no longer offered in the picker.
 */
export const LEGACY_HUB_TAGS = [
  "minijack",
  "longjack",
  "chordjack",
  "jumpstream",
  "handstream",
  "chordstream",
  "stream",
  "delay",
  "bracket",
  "tech",
] as const;

export const VALID_TAGS = [
  ...HUB_MODE_TAGS,
  "multi-mode",
  ...HUB_TAGS_BY_MODE.mania,
  ...HUB_TAGS_BY_MODE.std,
  ...HUB_TAGS_BY_MODE.ctb,
  ...HUB_TAGS_BY_MODE.taiko,
  ...LEGACY_HUB_TAGS,
] as const;

export type Tag = (typeof VALID_TAGS)[number];

export const collectionTags = sqliteTable(
  "collection_tags",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.tag] }),
    tagIdx: index("collection_tags_tag_idx").on(t.tag),
  })
);

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------
export const collectionFavorites = sqliteTable(
  "collection_favorites",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => hubUsers.id, { onDelete: "cascade" }),
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.collectionId] }),
    collectionIdIdx: index("collection_favorites_collection_id_idx").on(
      t.collectionId,
    ),
  })
);

// ---------------------------------------------------------------------------
// Search cache (admin-managed, used by download page)
// ---------------------------------------------------------------------------
export const searchCache = sqliteTable("search_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  queryHash: text("query_hash").notNull().unique(),
  queryParams: text("query_params").notNull(), // JSON string
  beatmapsetIds: text("beatmapset_ids").notNull().default("[]"), // JSON number[]
  totalCount: integer("total_count").notNull().default(0),
  label: text("label").notNull().default(""),
  /** Minutes between automatic cron refreshes; null/0 = manual only. */
  refreshIntervalMinutes: integer("refresh_interval_minutes"),
  /** Last successful prime/refresh. */
  lastRefreshAt: integer("last_refresh_at", { mode: "timestamp" }),
  /** Last refresh failure message (cleared on success). */
  refreshError: text("refresh_error"),
  /** Soft backoff after failure — cron skips until this time. */
  refreshBackoffUntil: integer("refresh_backoff_until", { mode: "timestamp" }),
  cachedAt: integer("cached_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type SearchCache = typeof searchCache.$inferSelect;
export type NewSearchCache = typeof searchCache.$inferInsert;

// ---------------------------------------------------------------------------
// Hub search index rows (one beatmapset per prime; diffs for star filters)
// ---------------------------------------------------------------------------
export const searchIndexSets = sqliteTable(
  "search_index_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cacheId: integer("cache_id")
      .notNull()
      .references(() => searchCache.id, { onDelete: "cascade" }),
    beatmapsetId: integer("beatmapset_id").notNull(),
    artist: text("artist").notNull().default(""),
    title: text("title").notNull().default(""),
    creator: text("creator").notNull().default(""),
    status: text("status").notNull().default(""),
    bpm: real("bpm"),
    favouriteCount: integer("favourite_count").notNull().default(0),
    playCount: integer("play_count").notNull().default(0),
    hasVideo: integer("has_video", { mode: "boolean" }).notNull().default(false),
    rankedDate: text("ranked_date"),
    lengthSeconds: integer("length_seconds"),
    position: integer("position").notNull(),
  },
  (t) => ({
    cachePositionIdx: index("search_index_sets_cache_position_idx").on(
      t.cacheId,
      t.position,
    ),
    cacheBpmIdx: index("search_index_sets_cache_bpm_idx").on(t.cacheId, t.bpm),
    cacheLengthIdx: index("search_index_sets_cache_length_idx").on(
      t.cacheId,
      t.lengthSeconds,
    ),
    cacheSetUnique: uniqueIndex("search_index_sets_cache_set_unique").on(
      t.cacheId,
      t.beatmapsetId,
    ),
  }),
);

export type SearchIndexSet = typeof searchIndexSets.$inferSelect;
export type NewSearchIndexSet = typeof searchIndexSets.$inferInsert;

export const searchIndexDiffs = sqliteTable(
  "search_index_diffs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    setRowId: integer("set_row_id")
      .notNull()
      .references(() => searchIndexSets.id, { onDelete: "cascade" }),
    beatmapId: integer("beatmap_id").notNull(),
    version: text("version").notNull().default("Unknown"),
    stars: real("stars").notNull().default(0),
    mode: text("mode").notNull().default("osu"),
    modeInt: integer("mode_int").notNull().default(0),
    keys: integer("keys"),
    totalLength: integer("total_length"),
  },
  (t) => ({
    setStarsIdx: index("search_index_diffs_set_stars_idx").on(
      t.setRowId,
      t.stars,
    ),
  }),
);

export type SearchIndexDiff = typeof searchIndexDiffs.$inferSelect;
export type NewSearchIndexDiff = typeof searchIndexDiffs.$inferInsert;

// ---------------------------------------------------------------------------
// Hub calc bundles (admin-published Sunny/Daniel/Rework dan + dominant skill)
// ---------------------------------------------------------------------------

/** Algorithms included in a Hub calc bundle (one bundle per Roxysu version). */
export const CALC_BUNDLE_ALGORITHMS = [
  "mania-difficulty",
  "mania-skill-v1",
] as const;

export type CalcBundleAlgorithm = (typeof CALC_BUNDLE_ALGORITHMS)[number];

export const calcBundles = sqliteTable("calc_bundles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Roxysu product version this bundle targets, e.g. "0.1.17". */
  roxysuVersion: text("roxysu_version").notNull().unique(),
  label: text("label").notNull().default(""),
  entryCount: integer("entry_count").notNull().default(0),
  /** JSON string array of algorithm ids included in this bundle. */
  algorithms: text("algorithms").notNull().default("[]"),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => hubUsers.id, {
    onDelete: "set null",
  }),
});

export type CalcBundle = typeof calcBundles.$inferSelect;
export type NewCalcBundle = typeof calcBundles.$inferInsert;

/**
 * One precomputed dan or pattern row, keyed by beatmap content hash.
 * Rework dan fills sunny_* / ln / est_diff (column name kept); pattern fills skill columns.
 */
export const calcBundleEntries = sqliteTable(
  "calc_bundle_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bundleId: integer("bundle_id")
      .notNull()
      .references(() => calcBundles.id, { onDelete: "cascade" }),
    beatmapHash: text("beatmap_hash").notNull(),
    onlineBeatmapId: integer("online_beatmap_id"),
    algorithm: text("algorithm").notNull(),
    sunnyStar: real("sunny_star"),
    lnRatio: real("ln_ratio"),
    columnCount: integer("column_count"),
    estDiff: text("est_diff"),
    dominantPattern: text("dominant_pattern"),
    secondaryPattern: text("secondary_pattern"),
    shapePattern: text("shape_pattern"),
    secondaryShape: text("secondary_shape"),
    confidence: real("confidence"),
    jackDensity: real("jack_density"),
    chordDensity: real("chord_density"),
    streamDensity: real("stream_density"),
    bracketDensity: real("bracket_density"),
    chordjackScore: real("chordjack_score"),
    jumpstreamScore: real("jumpstream_score"),
    chordstreamScore: real("chordstream_score"),
  },
  (t) => ({
    bundleHashAlgoUnique: uniqueIndex(
      "calc_bundle_entries_bundle_hash_algo_unique",
    ).on(t.bundleId, t.beatmapHash, t.algorithm),
    bundleAlgoIdx: index("calc_bundle_entries_bundle_algo_idx").on(
      t.bundleId,
      t.algorithm,
    ),
  }),
);

export type CalcBundleEntry = typeof calcBundleEntries.$inferSelect;
export type NewCalcBundleEntry = typeof calcBundleEntries.$inferInsert;

// ---------------------------------------------------------------------------
// Online score pull — ranked bests fetched from osu!api, plus usage ledger
// ---------------------------------------------------------------------------

/** One completed or in-progress ranked-best scan for a player and ruleset. */
export const osuScorePulls = sqliteTable(
  "osu_score_pulls",
  {
    osuUserId: integer("osu_user_id").notNull(),
    ruleset: text("ruleset").notNull(),
    topScoreId: integer("top_score_id"),
    scoreCount: integer("score_count").notNull().default(0),
    completeAt: integer("complete_at", { mode: "timestamp" }),
    status: text("status", {
      enum: ["idle", "running", "done", "error"],
    })
      .notNull()
      .default("idle"),
    pagesFetched: integer("pages_fetched").notNull().default(0),
    message: text("message"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.osuUserId, t.ruleset] }),
  }),
);

/** One ranked personal best, keyed by osu score id — not by page offset. */
export const osuBestScores = sqliteTable(
  "osu_best_scores",
  {
    osuUserId: integer("osu_user_id").notNull(),
    ruleset: text("ruleset").notNull(),
    scoreId: integer("score_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.osuUserId, t.ruleset, t.scoreId] }),
  }),
);

/** One row per UTC minute of outbound osu!api calls. Cache hits are separate. */
export const osuApiUsage = sqliteTable("osu_api_usage", {
  minuteBucket: integer("minute_bucket").primaryKey(),
  calls: integer("calls").notNull().default(0),
  cacheHits: integer("cache_hits").notNull().default(0),
  ok: integer("ok").notNull().default(0),
  notFound: integer("not_found").notNull().default(0),
  limited: integer("limited").notNull().default(0),
  other: integer("other").notNull().default(0),
  lowestRemaining: integer("lowest_remaining"),
});

/** Singleton park window after an osu! 429. Row id is always 1. */
export const osuApiPark = sqliteTable("osu_api_park", {
  id: integer("id").primaryKey(),
  parkedUntil: integer("parked_until"),
});

// ---------------------------------------------------------------------------
// BMS community scores — community-submitted, not server-verified
// ---------------------------------------------------------------------------

export const bmsCharts = sqliteTable(
  "bms_charts",
  {
    md5: text("md5").primaryKey(),
    sha256: text("sha256"),
    title: text("title"),
    artist: text("artist"),
    keyCount: integer("key_count"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    shaIdx: index("bms_charts_sha256_idx").on(t.sha256),
  }),
);

export const bmsScores = sqliteTable(
  "bms_scores",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => hubUsers.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    localScoreId: text("local_score_id").notNull(),
    chartMd5: text("chart_md5")
      .notNull()
      .references(() => bmsCharts.md5),
    achievedAt: integer("achieved_at", { mode: "timestamp" }).notNull(),
    exScore: integer("ex_score"),
    maxExScore: integer("max_ex_score"),
    normalizedScore: integer("normalized_score"),
    accuracy: real("accuracy"),
    pgreat: integer("pgreat"),
    great: integer("great"),
    good: integer("good"),
    bad: integer("bad"),
    poor: integer("poor"),
    miss: integer("miss"),
    variantId: text("variant_id").notNull(),
    gaugeId: text("gauge_id"),
    comboLampId: text("combo_lamp_id"),
    clearLampId: text("clear_lamp_id"),
    djGrade: text("dj_grade"),
    modsJson: text("mods_json").notNull(),
    trust: text("trust").notNull().default("community_submitted"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    sourceUnique: uniqueIndex("bms_scores_source_unique").on(
      t.userId,
      t.installationId,
      t.localScoreId,
    ),
    userVariantIdx: index("bms_scores_user_variant_idx").on(
      t.userId,
      t.variantId,
      t.achievedAt,
    ),
    chartIdx: index("bms_scores_chart_idx").on(t.chartMd5),
  }),
);

export const bmsScoreSubmissions = sqliteTable(
  "bms_score_submissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => hubUsers.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    localScoreId: text("local_score_id").notNull(),
    scoreId: text("score_id").references(() => bmsScores.id),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", {
      enum: ["accepted", "duplicate", "rejected"],
    }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    sourceUnique: uniqueIndex("bms_score_submissions_source_unique").on(
      t.userId,
      t.installationId,
      t.localScoreId,
    ),
  }),
);

export const bmsTables = sqliteTable("bms_tables", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().default(""),
  sourceUrl: text("source_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const bmsTableVersions = sqliteTable(
  "bms_table_versions",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => bmsTables.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    levelOrderJson: text("level_order_json").notNull(),
    unresolvedCount: integer("unresolved_count").notNull().default(0),
    importedAt: integer("imported_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    tableImportedIdx: index("bms_table_versions_table_imported_idx").on(
      t.tableId,
      t.importedAt,
    ),
  }),
);

export const bmsTableEntries = sqliteTable(
  "bms_table_entries",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => bmsTableVersions.id, { onDelete: "cascade" }),
    chartHash: text("chart_hash").notNull(),
    hashKind: text("hash_kind", { enum: ["md5", "sha256"] }).notNull(),
    sha256: text("sha256"),
    level: text("level").notNull(),
    levelIndex: integer("level_index").notNull(),
    title: text("title"),
    artist: text("artist"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.versionId, t.chartHash] }),
    versionLevelIdx: index("bms_table_entries_version_level_idx").on(
      t.versionId,
      t.levelIndex,
    ),
  }),
);
