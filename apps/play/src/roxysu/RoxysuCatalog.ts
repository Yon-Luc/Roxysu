import type { BeatmapInsightsRepository } from "../database/BeatmapInsightsRepository";
import type {
  CollectionRepository,
  CollectionFilter,
} from "../database/CollectionRepository";
import type { PlaySessionRepository } from "../database/PlaySessionRepository";
import type { ScoreRepository } from "../database/ScoreRepository";
import type {
  BeatmapInsights,
  CollectionSummary,
  ScoreSummary,
} from "../database/types";
import type { PlaySessionSummary } from "../database/PlaySessionRepository";

export class RoxysuCatalog {
  constructor(
    private readonly scores: ScoreRepository,
    private readonly insights: BeatmapInsightsRepository,
    private readonly collections: CollectionRepository,
    private readonly playSessions: PlaySessionRepository,
  ) {}

  listCollections(): CollectionSummary[] {
    return this.collections.list();
  }

  canFilterCollection(collection: CollectionSummary): boolean {
    return this.collections.canFilter(collection);
  }

  resolveCollectionFilter(
    collection: CollectionSummary | null,
  ): CollectionFilter | null {
    return this.collections.resolveFilter(collection);
  }

  getRealmBeatmapIds(collectionId: string): string[] {
    return this.collections.getRealmBeatmapIds(collectionId);
  }

  getBeatmapInsights(beatmapId: string): BeatmapInsights {
    return this.insights.getForBeatmap(beatmapId);
  }

  getScoreHistory(beatmapId: string, limit = 10): ScoreSummary[] {
    return this.scores.getByBeatmapId(beatmapId, limit);
  }

  getPlaySessions(beatmapId: string, limit = 10): PlaySessionSummary[] {
    return this.playSessions.getByBeatmapId(beatmapId, limit);
  }
}
