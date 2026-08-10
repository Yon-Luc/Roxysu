import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
export const collections = sqliteTable("collections", {
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
});

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;

// ---------------------------------------------------------------------------
// Collection beatmapset entries
// ---------------------------------------------------------------------------
export const collectionMaps = sqliteTable("collection_maps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  beatmapsetId: integer("beatmapset_id").notNull(),
  mapName: text("map_name").notNull().default(""),
});

export type CollectionMap = typeof collectionMaps.$inferSelect;
export type NewCollectionMap = typeof collectionMaps.$inferInsert;

// ---------------------------------------------------------------------------
// Collection tags
// ---------------------------------------------------------------------------
/** Primary gamemode tags shown in the hub filter row. */
export const HUB_MODE_TAGS = ["mania", "std", "ctb", "taiko"] as const;
export type HubModeTag = (typeof HUB_MODE_TAGS)[number];

/**
 * Secondary tags available per primary mode (plus shared patterns under each).
 * Mode tags themselves are also valid collection tags.
 */
export const HUB_TAGS_BY_MODE = {
  mania: [
    "4k",
    "7k",
    "ln",
    "rice",
    "hybrid",
    "sv",
    "dan",
    "jump",
    "stream",
    "tech",
    "beginner",
  ],
  std: ["jump", "stream", "tech", "aim", "beginner"],
  ctb: ["jump", "stream", "tech", "hyperdash", "beginner"],
  taiko: ["stream", "tech", "beginner"],
} as const satisfies Record<HubModeTag, readonly string[]>;

export const VALID_TAGS = [
  ...HUB_MODE_TAGS,
  "multi-mode",
  "4k",
  "7k",
  "ln",
  "rice",
  "hybrid",
  "sv",
  "dan",
  "jump",
  "stream",
  "tech",
  "aim",
  "hyperdash",
  "beginner",
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
