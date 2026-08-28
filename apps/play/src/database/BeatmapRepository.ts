import {
  and,
  asc,
  count,
  desc,
  eq,
  like,
  or,
  beatmaps,
  type Db,
} from "../integrations/roxysu-db";
import type { BeatmapSearchFilters, BeatmapSummary } from "./types";

function toSummary(row: typeof beatmaps.$inferSelect): BeatmapSummary {
  return {
    id: row.id,
    setId: row.setId,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficultyName,
    rulesetShortName: row.rulesetShortName,
    starRating: row.starRating,
    bpm: row.bpm,
    length: row.length,
    hash: row.hash,
    audioFileHash: row.audioFileHash,
    backgroundFileHash: row.backgroundFileHash,
    keyCount: row.circleSize,
  };
}

function buildWhere(filters: BeatmapSearchFilters = {}) {
  const clauses = [];

  if (filters.ruleset) {
    clauses.push(eq(beatmaps.rulesetShortName, filters.ruleset));
  }

  if (filters.keys != null) {
    clauses.push(eq(beatmaps.circleSize, filters.keys));
  }

  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    clauses.push(
      or(
        like(beatmaps.title, pattern),
        like(beatmaps.artist, pattern),
        like(beatmaps.difficultyName, pattern),
      )!,
    );
  }

  return clauses.length > 0 ? and(...clauses) : undefined;
}

export class BeatmapRepository {
  constructor(private readonly db: Db) {}

  getById(id: string): BeatmapSummary | null {
    const row = this.db
      .select()
      .from(beatmaps)
      .where(eq(beatmaps.id, id))
      .limit(1)
      .get();

    return row ? toSummary(row) : null;
  }

  getDifficulties(setId: string): BeatmapSummary[] {
    return this.db
      .select()
      .from(beatmaps)
      .where(eq(beatmaps.setId, setId))
      .orderBy(asc(beatmaps.starRating))
      .all()
      .map(toSummary);
  }

  search(filters: BeatmapSearchFilters = {}): BeatmapSummary[] {
    const where = buildWhere(filters);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const query = this.db
      .select()
      .from(beatmaps)
      .orderBy(desc(beatmaps.lastPlayed), desc(beatmaps.starRating))
      .limit(limit)
      .offset(offset);

    if (where) {
      query.where(where);
    }

    return query.all().map(toSummary);
  }

  count(filters: BeatmapSearchFilters = {}): number {
    const where = buildWhere(filters);
    const query = this.db.select({ value: count() }).from(beatmaps);

    if (where) {
      query.where(where);
    }

    return query.get()?.value ?? 0;
  }
}
