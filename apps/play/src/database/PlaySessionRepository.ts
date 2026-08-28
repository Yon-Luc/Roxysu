import { desc, eq, playSessions, type Db } from "../integrations/roxysu-db";
import type { PlayResult } from "../results/PlayResult";

export type PlaySessionSummary = {
  id: string;
  beatmapId: string;
  totalScore: number;
  accuracy: number;
  maxCombo: number;
  playedAt: Date;
};

function toSummary(row: typeof playSessions.$inferSelect): PlaySessionSummary {
  return {
    id: row.id,
    beatmapId: row.beatmapId,
    totalScore: row.totalScore,
    accuracy: row.accuracy,
    maxCombo: row.maxCombo,
    playedAt: row.playedAt,
  };
}

export class PlaySessionRepository {
  constructor(private readonly db: Db) {}

  insert(beatmapId: string, result: PlayResult): PlaySessionSummary {
    const id = crypto.randomUUID();
    const playedAt = new Date();
    const { counts } = result;

    this.db
      .insert(playSessions)
      .values({
        id,
        beatmapId,
        totalScore: result.score,
        accuracy: result.accuracy,
        maxCombo: result.maxCombo,
        perfect: counts.perfect,
        great: counts.great,
        good: counts.good,
        ok: counts.ok,
        meh: counts.meh,
        miss: counts.miss,
        playedAt,
      })
      .run();

    return {
      id,
      beatmapId,
      totalScore: result.score,
      accuracy: result.accuracy,
      maxCombo: result.maxCombo,
      playedAt,
    };
  }

  getByBeatmapId(beatmapId: string, limit = 10): PlaySessionSummary[] {
    return this.db
      .select()
      .from(playSessions)
      .where(eq(playSessions.beatmapId, beatmapId))
      .orderBy(desc(playSessions.playedAt))
      .limit(limit)
      .all()
      .map(toSummary);
  }
}
