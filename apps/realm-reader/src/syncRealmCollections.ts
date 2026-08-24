import {
  beatmapSets,
  beatmaps,
  eq,
  inArray,
  realmCollectionHashes,
  realmCollections,
  type Db,
} from "@roxysu/db/client.node";
import Realm from "realm";

type BeatmapCollectionObj = Realm.Object & {
  ID: Realm.BSON.UUID;
  Name: string;
  BeatmapMD5Hashes: Realm.List<string>;
  LastModified: Date;
};

const HASH_LOOKUP_CHUNK = 400;

export type RealmCollectionSyncCounts = {
  collectionsUpserted: number;
  hashesUpserted: number;
  collectionsDeleted: number;
};

export type SyncRealmCollectionsOptions = {
  /** When true, rewrite hashes even if lastModified+hashCount match. */
  rewriteUnchanged?: boolean;
};

function playedAtMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

function sameTime(
  a: Date | number | null | undefined,
  b: Date | number | null | undefined,
): boolean {
  const am = playedAtMs(a);
  const bm = playedAtMs(b);
  if (am == null && bm == null) return true;
  if (am == null || bm == null) return false;
  return am === bm;
}

/**
 * Mirror all lazer BeatmapCollection rows into SQLite and resolve MD5 →
 * beatmapset online IDs for maps present in the local library.
 */
export function syncRealmCollectionsFromRealm(
  db: Db,
  realm: Realm,
  options?: SyncRealmCollectionsOptions,
): RealmCollectionSyncCounts {
  const rewriteUnchanged = options?.rewriteUnchanged === true;
  const syncedAt = new Date();
  const seenIds = new Set<string>();

  const all = realm.objects<BeatmapCollectionObj>("BeatmapCollection");
  const pending: Array<{
    id: string;
    name: string;
    lastModified: Date | null;
    hashes: string[];
  }> = [];

  for (const col of all) {
    const id = col.ID.toString();
    seenIds.add(id);
    const hashes: string[] = [];
    for (const h of col.BeatmapMD5Hashes) {
      if (typeof h === "string" && h.length > 0) hashes.push(h.toLowerCase());
    }
    pending.push({
      id,
      name: col.Name ?? "",
      lastModified: col.LastModified ?? null,
      hashes: [...new Set(hashes)],
    });
  }

  const existing = db
    .select({
      id: realmCollections.id,
      lastModified: realmCollections.lastModified,
      hashCount: realmCollections.hashCount,
    })
    .from(realmCollections)
    .all();
  const existingById = new Map(existing.map((row) => [row.id, row]));

  const toWrite = pending.filter((col) => {
    if (rewriteUnchanged) return true;
    const prev = existingById.get(col.id);
    if (!prev) return true;
    return (
      !sameTime(prev.lastModified, col.lastModified) ||
      prev.hashCount !== col.hashes.length
    );
  });

  const uniqueHashes = [...new Set(toWrite.flatMap((p) => p.hashes))];
  const md5ToOnlineId = resolveMd5ToOnlineIds(db, uniqueHashes);

  return db.transaction((tx) => {
    let collectionsUpserted = 0;
    let hashesUpserted = 0;

    for (const col of toWrite) {
      const resolvedIds = new Set<number>();
      for (const hash of col.hashes) {
        const onlineId = md5ToOnlineId.get(hash);
        if (onlineId != null && onlineId > 0) resolvedIds.add(onlineId);
      }

      tx.insert(realmCollections)
        .values({
          id: col.id,
          name: col.name,
          lastModified: col.lastModified,
          hashCount: col.hashes.length,
          resolvedSetCount: resolvedIds.size,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: realmCollections.id,
          set: {
            name: col.name,
            lastModified: col.lastModified,
            hashCount: col.hashes.length,
            resolvedSetCount: resolvedIds.size,
            syncedAt,
          },
        })
        .run();
      collectionsUpserted += 1;

      tx.delete(realmCollectionHashes)
        .where(eq(realmCollectionHashes.collectionId, col.id))
        .run();

      if (col.hashes.length === 0) continue;

      const hashRows = col.hashes.map((md5Hash) => ({
        collectionId: col.id,
        md5Hash,
        beatmapsetOnlineId: md5ToOnlineId.get(md5Hash) ?? null,
      }));

      for (let i = 0; i < hashRows.length; i += HASH_LOOKUP_CHUNK) {
        const chunk = hashRows.slice(i, i + HASH_LOOKUP_CHUNK);
        tx.insert(realmCollectionHashes)
          .values(chunk)
          .onConflictDoNothing()
          .run();
        hashesUpserted += chunk.length;
      }
    }

    const staleIds = existing
      .map((row) => row.id)
      .filter((id) => !seenIds.has(id));
    let collectionsDeleted = 0;
    for (let i = 0; i < staleIds.length; i += HASH_LOOKUP_CHUNK) {
      const chunk = staleIds.slice(i, i + HASH_LOOKUP_CHUNK);
      tx.delete(realmCollectionHashes)
        .where(inArray(realmCollectionHashes.collectionId, chunk))
        .run();
      const deleted = tx
        .delete(realmCollections)
        .where(inArray(realmCollections.id, chunk))
        .run();
      collectionsDeleted += deleted.changes ?? chunk.length;
    }

    return { collectionsUpserted, hashesUpserted, collectionsDeleted };
  });
}

function resolveMd5ToOnlineIds(
  db: Db,
  hashes: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (hashes.length === 0) return out;

  for (let i = 0; i < hashes.length; i += HASH_LOOKUP_CHUNK) {
    const chunk = hashes.slice(i, i + HASH_LOOKUP_CHUNK);
    const rows = db
      .select({
        md5Hash: beatmaps.md5Hash,
        onlineId: beatmapSets.onlineId,
      })
      .from(beatmaps)
      .innerJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
      .where(inArray(beatmaps.md5Hash, chunk))
      .all();

    for (const row of rows) {
      if (!row.md5Hash || row.onlineId <= 0) continue;
      const key = row.md5Hash.toLowerCase();
      if (!out.has(key)) out.set(key, row.onlineId);
    }
  }

  return out;
}
