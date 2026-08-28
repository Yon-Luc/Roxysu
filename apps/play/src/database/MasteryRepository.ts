import { eq, mastery, type Db } from "../integrations/roxysu-db";
import type { MasterySummary } from "./types";

function toSummary(row: typeof mastery.$inferSelect): MasterySummary {
  return {
    beatmapId: row.beatmapId,
    level: row.level,
    playCount: row.playCount,
    bestAccuracy: row.bestAccuracy,
    bestPp: row.bestPp,
    lastPlayedAt: row.lastPlayedAt,
    formulaId: row.formulaId,
  };
}

export class MasteryRepository {
  constructor(private readonly db: Db) {}

  getByBeatmapId(beatmapId: string): MasterySummary | null {
    const row = this.db
      .select()
      .from(mastery)
      .where(eq(mastery.beatmapId, beatmapId))
      .limit(1)
      .get();

    return row ? toSummary(row) : null;
  }
}
