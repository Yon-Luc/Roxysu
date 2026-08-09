/** Roxysu-owned lazer collection name prefix (includes trailing space). */
export const LAZER_COLLECTION_PREFIX = "!Roxysu ";

export type CollectionSyncInput = {
  /**
   * Local smart-collection id, or a synthetic id for hub-added rows
   * (`HUB_SYNC_ID_BASE + hubCollectionId`).
   */
  id: number;
  name: string;
  lazerCollectionId: string | null;
  md5Hashes: string[];
  /** When set, lazer UUID is written back to `hub_added_collections`. */
  hubCollectionId?: number;
};

/** Offset so hub-added sync ids never collide with smart collection ids. */
export const HUB_SYNC_ID_BASE = 1_000_000_000;

export function hubSyncId(hubCollectionId: number): number {
  return HUB_SYNC_ID_BASE + hubCollectionId;
}

export type CollectionSyncPayload = {
  collections: CollectionSyncInput[];
  skippedNoMd5: number;
};

export type CollectionSyncSuccess = {
  ok: true;
  created: number;
  updated: number;
  deleted: number;
  skippedNoMd5: number;
  backupPath: string;
  syncedAt: string;
};

export type CollectionSyncFailure = {
  ok: false;
  error: string;
  code: "locked" | "schema_mismatch" | "other";
};

export type CollectionSyncResult = CollectionSyncSuccess | CollectionSyncFailure;

/** Success fields without the `ok` discriminant (server/UI wire shape). */
export type LazerCollectionSyncSuccess = Omit<CollectionSyncSuccess, "ok">;

export type LazerCollectionSyncError = {
  error: string;
  code: CollectionSyncFailure["code"];
};

export function lazerCollectionName(name: string): string {
  return `${LAZER_COLLECTION_PREFIX}${name}`;
}

export function isManagedCollectionName(name: string | null | undefined): boolean {
  return (name ?? "").startsWith(LAZER_COLLECTION_PREFIX);
}
