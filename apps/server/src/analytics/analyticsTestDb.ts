import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "@roxysu/db/client.bun";
import {
  beatmapManiaRatings,
  beatmapSets,
  beatmaps,
  scores,
  settings,
} from "@roxysu/db/schema";
import {
  SCORES_GAMEMODE_ALL,
  SCORES_GAMEMODE_FILTER_KEY,
  SCORES_USERNAME_ALL,
  SCORES_USERNAME_FILTER_KEY,
} from "@roxysu/db/settings-keys";
import type { Db } from "../db-runtime";
import { LAZER_MASTER_VERSION } from "../mania-rating/registry";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(
  here,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

/** In-memory migrated DB with username/gamemode filters set to "all" (no auto-filter cache). */
export function createAnalyticsTestDb(): Db {
  const db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  db.insert(settings)
    .values([
      { key: SCORES_USERNAME_FILTER_KEY, value: SCORES_USERNAME_ALL },
      { key: SCORES_GAMEMODE_FILTER_KEY, value: SCORES_GAMEMODE_ALL },
    ])
    .run();
  return db;
}

export function seedBeatmap(
  db: Db,
  id: string,
  curve?: { ppByAccuracy: Record<string, number>; ppSs: number },
): void {
  db.insert(beatmapSets)
    .values({
      id: `set-${id}`,
      onlineId: 1,
      dateAdded: new Date(0),
      status: 1,
    })
    .run();
  db.insert(beatmaps)
    .values({
      id,
      onlineId: 1,
      setId: `set-${id}`,
      rulesetShortName: "mania",
      status: 1,
      length: 1,
      bpm: 1,
      starRating: 1,
    })
    .run();
  if (curve) {
    db.insert(beatmapManiaRatings)
      .values({
        beatmapId: id,
        versionId: LAZER_MASTER_VERSION,
        ppSs: curve.ppSs,
        ppByAccuracyJson: JSON.stringify(curve.ppByAccuracy),
        updatedAt: new Date(0),
      })
      .run();
  }
}

export function seedScore(
  db: Db,
  partial: {
    id: string;
    beatmapId?: string | null;
    playedAt: number;
    accuracy?: number;
    pp?: number | null;
    mods?: string | null;
  },
): void {
  db.insert(scores)
    .values({
      id: partial.id,
      onlineId: 0,
      legacyOnlineId: 0,
      beatmapId: partial.beatmapId ?? null,
      rulesetShortName: "mania",
      accuracy: partial.accuracy ?? 0.95,
      pp: partial.pp ?? null,
      mods: partial.mods ?? "[]",
      playedAt: new Date(partial.playedAt),
      userUsername: "tester",
    })
    .run();
}
