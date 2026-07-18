import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

export const scores = sqliteTable("scores", {
  id: integer("id").primaryKey(),
  beatmapId: text("beatmap_id").notNull(),
  accuracy: integer("accuracy").notNull(),
  playedAt: integer("played_at", { mode: "timestamp" }).notNull(),
});
