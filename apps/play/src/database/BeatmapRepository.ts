import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  like,
  or,
  beatmaps,
  type Db,
} from "../integrations/roxysu-db";
import type { BeatmapSearchFilters, BeatmapSummary } from "./types";
import type { SongSortBy, SongSortDir } from "../songselect/SongSort";

function orderByClause(sortBy: SongSortBy = "lastPlayed", sortDir: SongSortDir = "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "title":
      return [direction(beatmaps.title), direction(beatmaps.starRating)];
    case "artist":
      return [direction(beatmaps.artist), direction(beatmaps.title)];
    case "stars":
      return [direction(beatmaps.starRating), direction(beatmaps.title)];
    case "bpm":
      return [direction(beatmaps.bpm), direction(beatmaps.starRating)];
    case "length":
      return [direction(beatmaps.length), direction(beatmaps.starRating)];
    case "lastPlayed":
    default:
      return sortDir === "asc"
        ? [asc(beatmaps.lastPlayed), asc(beatmaps.starRating)]
        : [desc(beatmaps.lastPlayed), desc(beatmaps.starRating)];
  }
}

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
    overallDifficulty: row.overallDifficulty,
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

  if (filters.beatmapIds != null) {
    if (filters.beatmapIds.length === 0) {
      clauses.push(eq(beatmaps.id, "__no_matches__"));
    } else {
      clauses.push(inArray(beatmaps.id, filters.beatmapIds));
    }
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
      .orderBy(...orderByClause(filters.sortBy, filters.sortDir))
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
