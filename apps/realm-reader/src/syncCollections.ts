import { collections, eq, hubAddedCollections, type Db } from "@roxysu/db/client.node";
import {
  type CollectionSyncPayload,
  type CollectionSyncResult,
  isManagedCollectionName,
  lazerCollectionName,
} from "@roxysu/collection-sync";
import { backupRealmFile } from "@roxysu/realm-backup";
import Realm from "realm";
import { loadOsuSchema } from "./schema";
import { RealmLockedError, SchemaVersionMismatchError } from "./sync";

export type {
  CollectionSyncInput,
  CollectionSyncPayload,
  CollectionSyncSuccess,
  CollectionSyncFailure,
  CollectionSyncResult,
} from "@roxysu/collection-sync";
export { LAZER_COLLECTION_PREFIX } from "@roxysu/collection-sync";

type BeatmapCollectionObj = Realm.Object & {
  ID: Realm.BSON.UUID;
  Name: string;
  BeatmapMD5Hashes: Realm.List<string>;
  LastModified: Date;
};

function isLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("lock") ||
    lower.includes("already opened") ||
    lower.includes("already in use") ||
    lower.includes("resource busy") ||
    lower.includes("ebusy") ||
    lower.includes("eacces") ||
    lower.includes("permission denied")
  );
}

function realmUuid(id: string): Realm.BSON.UUID {
  return new Realm.BSON.UUID(id);
}

function openRealmForWrite(realmPath: string): Realm {
  const { schemaVersion, schema } = loadOsuSchema();
  try {
    return new Realm({
      path: realmPath,
      schema,
      schemaVersion,
      readOnly: false,
    });
  } catch (err) {
    if (isLockError(err)) {
      throw new RealmLockedError(
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

function openRealmReadOnly(realmPath: string): Realm {
  const { schemaVersion, schema } = loadOsuSchema();
  return new Realm({
    path: realmPath,
    schema,
    schemaVersion,
    readOnly: true,
  });
}

function assertSchemaVersion(realm: Realm): void {
  const expected = loadOsuSchema().schemaVersion;
  const actual = realm.schemaVersion;
  if (actual !== expected) {
    throw new SchemaVersionMismatchError(expected, actual);
  }
}

function replaceMd5List(list: Realm.List<string>, hashes: string[]): void {
  list.splice(0, list.length, ...hashes);
}

function countManagedCollections(realm: Realm): number {
  const all = realm.objects<BeatmapCollectionObj>("BeatmapCollection");
  let n = 0;
  for (const col of all) {
    if (isManagedCollectionName(col.Name)) n += 1;
  }
  return n;
}

export function runCollectionSync(
  db: Db,
  dbPath: string,
  realmPath: string,
  payload: CollectionSyncPayload,
): CollectionSyncResult {
  let realm: Realm | null = null;

  try {
    realm = openRealmForWrite(realmPath);
    assertSchemaVersion(realm);

    const backupPath = backupRealmFile(realmPath, dbPath);
    const syncedAt = new Date();
    const trackedIds = new Set<string>();
    const newLazerIds = new Map<number, string>();

    let created = 0;
    let updated = 0;
    let deleted = 0;

    realm.write(() => {
      for (const col of payload.collections) {
        const lazerName = lazerCollectionName(col.name);
        const hashes = col.md5Hashes;

        if (col.lazerCollectionId) {
          const existing = realm!.objectForPrimaryKey<BeatmapCollectionObj>(
            "BeatmapCollection",
            realmUuid(col.lazerCollectionId),
          );
          if (existing) {
            existing.Name = lazerName;
            replaceMd5List(existing.BeatmapMD5Hashes, hashes);
            existing.LastModified = syncedAt;
            trackedIds.add(col.lazerCollectionId);
            updated += 1;
            continue;
          }
        }

        const id = new Realm.BSON.UUID();
        realm!.create("BeatmapCollection", {
          ID: id,
          Name: lazerName,
          BeatmapMD5Hashes: hashes,
          LastModified: syncedAt,
        });
        const idStr = id.toString();
        trackedIds.add(idStr);
        newLazerIds.set(col.id, idStr);
        created += 1;
      }

      const allCollections = realm!.objects<BeatmapCollectionObj>(
        "BeatmapCollection",
      );
      for (const existing of [...allCollections]) {
        if (!isManagedCollectionName(existing.Name)) continue;
        const idStr = existing.ID.toString();
        if (trackedIds.has(idStr)) continue;
        realm!.delete(existing);
        deleted += 1;
      }
    });

    realm.close();
    realm = null;

    for (const col of payload.collections) {
      const newId = newLazerIds.get(col.id);
      const lazerCollectionId = newId ?? col.lazerCollectionId;
      if (col.hubCollectionId != null) {
        db.update(hubAddedCollections)
          .set({
            lazerCollectionId,
            lazerSyncedAt: syncedAt,
            updatedAt: syncedAt,
          })
          .where(eq(hubAddedCollections.hubCollectionId, col.hubCollectionId))
          .run();
      } else {
        db.update(collections)
          .set({
            lazerCollectionId,
            lazerSyncedAt: syncedAt,
          })
          .where(eq(collections.id, col.id))
          .run();
      }
    }

    const verify = openRealmReadOnly(realmPath);
    assertSchemaVersion(verify);
    const managedCount = countManagedCollections(verify);
    verify.close();

    if (managedCount !== payload.collections.length) {
      return {
        ok: false,
        error: `Post-sync sanity check failed: expected ${payload.collections.length} managed collections, found ${managedCount}`,
        code: "other",
      };
    }

    return {
      ok: true,
      created,
      updated,
      deleted,
      skippedNoMd5: payload.skippedNoMd5,
      backupPath,
      syncedAt: syncedAt.toISOString(),
    };
  } catch (err) {
    if (realm) {
      try {
        realm.close();
      } catch {
        // ignore
      }
    }

    if (err instanceof RealmLockedError) {
      return {
        ok: false,
        error: "client.realm is locked — close osu!lazer and try again",
        code: "locked",
      };
    }
    if (err instanceof SchemaVersionMismatchError) {
      return {
        ok: false,
        error: err.message,
        code: "schema_mismatch",
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, code: "other" };
  }
}
