import type { BeatmapInsightsRepository } from "../database/BeatmapInsightsRepository";
import type {
  CollectionRepository,
  CollectionFilter,
} from "../database/CollectionRepository";
import type { ScoreRepository } from "../database/ScoreRepository";
import type {
  BeatmapInsights,
  CollectionSummary,
  ScoreSummary,
} from "../database/types";

export class RoxysuCatalog {
  constructor(
    private readonly scores: ScoreRepository,
    private readonly insights: BeatmapInsightsRepository,
    private readonly collections: CollectionRepository,
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
}
