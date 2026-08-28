import {
  desc,
  eq,
  scores,
  type Db,
} from "../integrations/roxysu-db";
import type { ScoreSummary } from "./types";

function toSummary(row: typeof scores.$inferSelect): ScoreSummary {
  return {
    id: row.id,
    beatmapId: row.beatmapId,
    totalScore: row.totalScore,
    accuracy: row.accuracy,
    maxCombo: row.maxCombo,
    rank: row.rank,
    playedAt: row.playedAt,
    rulesetShortName: row.rulesetShortName,
  };
}

export class ScoreRepository {
  constructor(private readonly db: Db) {}

  getByBeatmapId(beatmapId: string, limit = 20): ScoreSummary[] {
    return this.db
      .select()
      .from(scores)
      .where(eq(scores.beatmapId, beatmapId))
      .orderBy(desc(scores.playedAt))
      .limit(limit)
      .all()
      .map(toSummary);
  }
}
