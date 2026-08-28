import {
  and,
  beatmapDanRatings,
  beatmapManiaRatings,
  beatmapPatternAnalysis,
  eq,
  inArray,
  mastery,
  type Db,
} from "../integrations/roxysu-db";
import {
  MANIA_RATING_VERSION,
  PATTERN_ALGORITHM,
  SUNNY_DAN_ALGORITHM,
} from "../integrations/roxysu-insights";
import type { BeatmapInsights } from "./types";

function emptyInsights(beatmapId: string): BeatmapInsights {
  return {
    beatmapId,
    mastery: null,
    pattern: null,
    maniaRating: null,
    danRating: null,
  };
}

export class BeatmapInsightsRepository {
  constructor(private readonly db: Db) {}

  getForBeatmap(beatmapId: string): BeatmapInsights {
    const [result] = this.getForBeatmaps([beatmapId]);
    return result ?? emptyInsights(beatmapId);
  }

  getForBeatmaps(beatmapIds: string[]): BeatmapInsights[] {
    if (beatmapIds.length === 0) return [];

    const masteryRows = this.db
      .select()
      .from(mastery)
      .where(inArray(mastery.beatmapId, beatmapIds))
      .all();

    const patternRows = this.db
      .select()
      .from(beatmapPatternAnalysis)
      .where(
        and(
          inArray(beatmapPatternAnalysis.beatmapId, beatmapIds),
          eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        ),
      )
      .all();

    const maniaRows = this.db
      .select()
      .from(beatmapManiaRatings)
      .where(
        and(
          inArray(beatmapManiaRatings.beatmapId, beatmapIds),
          eq(beatmapManiaRatings.versionId, MANIA_RATING_VERSION),
        ),
      )
      .all();

    const danRows = this.db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          inArray(beatmapDanRatings.beatmapId, beatmapIds),
          eq(beatmapDanRatings.algorithm, SUNNY_DAN_ALGORITHM),
        ),
      )
      .all();

    const masteryById = new Map(masteryRows.map((row) => [row.beatmapId, row]));
    const patternById = new Map(patternRows.map((row) => [row.beatmapId, row]));
    const maniaById = new Map(maniaRows.map((row) => [row.beatmapId, row]));
    const danById = new Map(danRows.map((row) => [row.beatmapId, row]));

    return beatmapIds.map((beatmapId) => {
      const masteryRow = masteryById.get(beatmapId);
      const patternRow = patternById.get(beatmapId);
      const maniaRow = maniaById.get(beatmapId);
      const danRow = danById.get(beatmapId);

      return {
        beatmapId,
        mastery: masteryRow
          ? {
              beatmapId,
              level: masteryRow.level,
              playCount: masteryRow.playCount,
              bestAccuracy: masteryRow.bestAccuracy,
              bestPp: masteryRow.bestPp,
              lastPlayedAt: masteryRow.lastPlayedAt,
              formulaId: masteryRow.formulaId,
            }
          : null,
        pattern: patternRow
          ? {
              beatmapId,
              dominantPattern: patternRow.dominantPattern,
              secondaryPattern: patternRow.secondaryPattern,
              confidence: patternRow.confidence,
            }
          : null,
        maniaRating: maniaRow
          ? {
              beatmapId,
              starRating: maniaRow.starRating,
              starRatingSs: maniaRow.starRatingSs,
              ppSs: maniaRow.ppSs,
            }
          : null,
        danRating: danRow
          ? {
              beatmapId,
              estDiff: danRow.estDiff,
              sunnyStar: danRow.sunnyStar,
            }
          : null,
      };
    });
  }
}
