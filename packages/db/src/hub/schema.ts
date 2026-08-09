import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
export const VALID_TAGS = [
  "mania",
  "4k",
  "7k",
  "multi-mode",
  "jump",
  "stream",
  "tech",
  "ln",
  "rice",
  "hybrid",
  "sv",
  "beginner",
  "dan",
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
  cachedAt: integer("cached_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type SearchCache = typeof searchCache.$inferSelect;
export type NewSearchCache = typeof searchCache.$inferInsert;
