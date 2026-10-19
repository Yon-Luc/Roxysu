import {
  and,
  asc,
  beatmaps,
  collections,
  desc,
  eq,
  realmCollectionHashes,
  realmCollections,
  type Db,
} from "../integrations/roxysu-db";
import type { CollectionSummary } from "./types";

export type CollectionFilter =
  | { kind: "realm"; id: string }
  | { kind: "smart"; id: number; query: string };

export type RealmBeatmapIdFilter = {
  /** Ruleset short name, e.g. "mania". */
  ruleset?: string;
  /** Key count, stored as `beatmaps.circle_size` for mania. */
  keys?: number;
};

export class CollectionRepository {
  constructor(private readonly db: Db) {}

  list(): CollectionSummary[] {
    const smartRows = this.db
      .select()
      .from(collections)
      .orderBy(desc(collections.updatedAt))
      .all();

    const realmRows = this.db
      .select()
      .from(realmCollections)
      .orderBy(desc(realmCollections.lastModified))
      .all();

    const smartItems: CollectionSummary[] = smartRows.map((row) => ({
      kind: "smart",
      id: String(row.id),
      name: row.name,
      mapCount: row.cachedMatchCount,
      query: row.query,
    }));

    const realmItems: CollectionSummary[] = realmRows.map((row) => ({
      kind: "realm",
      id: row.id,
      name: row.name,
      mapCount: row.hashCount,
    }));

    return [...smartItems, ...realmItems];
  }

  /**
   * Beatmap ids of a Realm collection, ordered by title. With `filter`, the
   * ruleset and key count (`circleSize`) are applied in the same query so the
   * caller needs no per-beatmap lookup.
   */
  getRealmBeatmapIds(
    collectionId: string,
    filter: RealmBeatmapIdFilter = {},
  ): string[] {
    const clauses = [eq(realmCollectionHashes.collectionId, collectionId)];
    if (filter.ruleset != null) {
      clauses.push(eq(beatmaps.rulesetShortName, filter.ruleset));
    }
    if (filter.keys != null) {
      clauses.push(eq(beatmaps.circleSize, filter.keys));
    }
    return this.db
      .select({ id: beatmaps.id })
      .from(realmCollectionHashes)
      .innerJoin(beatmaps, eq(beatmaps.md5Hash, realmCollectionHashes.md5Hash))
      .where(and(...clauses))
      .orderBy(asc(beatmaps.title))
      .all()
      .map((row) => row.id);
  }

  resolveFilter(
    collection: CollectionSummary | null,
  ): CollectionFilter | null {
    if (!collection) return null;

    if (collection.kind === "realm") {
      return { kind: "realm", id: collection.id };
    }

    if (collection.query) {
      return {
        kind: "smart",
        id: Number(collection.id),
        query: collection.query,
      };
    }

    return null;
  }

  canFilter(collection: CollectionSummary): boolean {
    return collection.kind === "realm";
  }
}
