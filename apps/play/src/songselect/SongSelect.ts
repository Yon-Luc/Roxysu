import type { AssetResolver } from "../assets/AssetResolver";
import type { BeatmapRepository } from "../database/BeatmapRepository";
import type { CollectionSummary } from "../database/types";
import type { RoxysuCatalog } from "../roxysu/RoxysuCatalog";
import type { BeatmapSearchFilters, BeatmapSummary } from "../database/types";

export type SongSelectEntry = BeatmapSummary & {
  beatmapAvailable: boolean;
};

export type SongSelectQuery = {
  query?: string;
  offset?: number;
  limit?: number;
  collection?: CollectionSummary | null;
};

export type SongSelectPage = {
  entries: SongSelectEntry[];
  total: number;
  offset: number;
  limit: number;
  collectionFilterActive: boolean;
  collectionFilterSupported: boolean;
};

const DEFAULT_LIMIT = 40;

export class SongSelect {
  constructor(
    private readonly beatmaps: BeatmapRepository,
    private readonly catalog: RoxysuCatalog,
    private readonly assets: AssetResolver,
    private readonly keys = 7,
  ) {}

  search(query: SongSelectQuery = {}): SongSelectPage {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const collection = query.collection ?? null;
    const collectionFilterSupported =
      collection == null || this.catalog.canFilterCollection(collection);
    const beatmapIds = this.resolveBeatmapIds(collection);

    const baseFilters: BeatmapSearchFilters = {
      ruleset: "mania",
      keys: this.keys,
      query: query.query,
      beatmapIds: beatmapIds ?? undefined,
    };

    const entries = this.beatmaps
      .search({ ...baseFilters, limit, offset })
      .map((beatmap) => ({
        ...beatmap,
        beatmapAvailable:
          beatmap.hash != null &&
          this.assets.resolveBeatmap(beatmap.hash).status === "available",
      }));

    return {
      entries,
      total: this.beatmaps.count(baseFilters),
      offset,
      limit,
      collectionFilterActive: beatmapIds != null,
      collectionFilterSupported,
    };
  }

  private resolveBeatmapIds(
    collection: CollectionSummary | null,
  ): string[] | null {
    if (!collection) return null;
    if (!this.catalog.canFilterCollection(collection)) return null;

    const ids = this.catalog.getRealmBeatmapIds(collection.id);
    return ids.filter((id) => {
      const beatmap = this.beatmaps.getById(id);
      return (
        beatmap?.rulesetShortName === "mania" && beatmap.keyCount === this.keys
      );
    });
  }
}
