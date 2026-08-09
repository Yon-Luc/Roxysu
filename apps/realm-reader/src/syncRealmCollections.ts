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

/**
 * Mirror all lazer BeatmapCollection rows into SQLite and resolve MD5 →
 * beatmapset online IDs for maps present in the local library.
 */
export function syncRealmCollectionsFromRealm(
  db: Db,
  realm: Realm,
): RealmCollectionSyncCounts {
  const syncedAt = new Date();
  const seenIds = new Set<string>();
  let collectionsUpserted = 0;
  let hashesUpserted = 0;

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
      hashes,
    });
  }

  const uniqueHashes = [...new Set(pending.flatMap((p) => p.hashes))];
  const md5ToOnlineId = resolveMd5ToOnlineIds(db, uniqueHashes);

  for (const col of pending) {
    const resolvedIds = new Set<number>();
    for (const hash of col.hashes) {
      const onlineId = md5ToOnlineId.get(hash);
      if (onlineId != null && onlineId > 0) resolvedIds.add(onlineId);
    }

    db.insert(realmCollections)
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

    db.delete(realmCollectionHashes)
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
      db.insert(realmCollectionHashes).values(chunk).run();
      hashesUpserted += chunk.length;
    }
  }

  const existing = db
    .select({ id: realmCollections.id })
    .from(realmCollections)
    .all();
  let collectionsDeleted = 0;
  for (const row of existing) {
    if (seenIds.has(row.id)) continue;
    db.delete(realmCollections).where(eq(realmCollections.id, row.id)).run();
    collectionsDeleted += 1;
  }

  return { collectionsUpserted, hashesUpserted, collectionsDeleted };
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
