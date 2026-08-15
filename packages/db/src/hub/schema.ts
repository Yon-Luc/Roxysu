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
      label: "Pattern",
      tags: [
        "jack",
        "minijack",
        "longjack",
        "chordjack",
        "jumpstream",
        "handstream",
        "chordstream",
        "stream",
        "delay",
        "bracket",
      ],
    },
    { label: "Style", tags: ["ln", "rice", "hybrid", "sv", "tech"] },
    { label: "Difficulty", tags: ["stamina", "speed", "dan", "beginner"] },
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

export const VALID_TAGS = [
  ...HUB_MODE_TAGS,
  "multi-mode",
  ...HUB_TAGS_BY_MODE.mania,
  ...HUB_TAGS_BY_MODE.std,
  ...HUB_TAGS_BY_MODE.ctb,
  ...HUB_TAGS_BY_MODE.taiko,
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
