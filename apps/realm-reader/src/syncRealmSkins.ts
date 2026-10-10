import {
  eq,
  inArray,
  realmSkinFiles,
  realmSkins,
  type Db,
} from "@roxysu/db/client.node";
import Realm from "realm";

type RealmObj = Record<string, any>;

const FILE_CHUNK = 400;

export type RealmSkinSyncCounts = {
  skinsUpserted: number;
  filesUpserted: number;
  skinsDeleted: number;
};

function uuidString(value: unknown): string {
  if (value == null) throw new Error("expected uuid");
  return String(value);
}

function fileUsageHash(usage: RealmObj): string | null {
  const file = usage.File as RealmObj | null | undefined;
  const hash = file?.Hash as string | null | undefined;
  if (hash && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
  return null;
}

function normalizeFilename(name: string): string {
  return name.replace(/\\/g, "/");
}

function isSkinIni(filename: string): boolean {
  const base = normalizeFilename(filename).split("/").pop() ?? filename;
  return base.toLowerCase() === "skin.ini";
}

type SkinPending = {
  id: string;
  name: string | null;
  creator: string | null;
  hash: string | null;
  protected: boolean;
  deletePending: boolean;
  instantiationInfo: string | null;
  hasSkinIni: boolean;
  files: Array<{ filename: string; fileHash: string }>;
};

function mapSkinFromRealm(obj: RealmObj): SkinPending | null {
  let id: string;
  try {
    id = uuidString(obj.ID);
  } catch {
    return null;
  }

  const files: Array<{ filename: string; fileHash: string }> = [];
  const seenNames = new Set<string>();
  let hasSkinIni = false;

  const usages = obj.Files as RealmObj[] | null | undefined;
  if (usages) {
    for (const usage of usages) {
      const rawName = usage.Filename as string | null | undefined;
      if (!rawName) continue;
      const filename = normalizeFilename(rawName);
      if (!filename || seenNames.has(filename)) continue;
      const fileHash = fileUsageHash(usage);
      if (!fileHash) continue;
      seenNames.add(filename);
      if (isSkinIni(filename)) hasSkinIni = true;
      files.push({ filename, fileHash });
    }
  }

  return {
    id,
    name: (obj.Name as string | null | undefined) ?? null,
    creator: (obj.Creator as string | null | undefined) ?? null,
    hash: (obj.Hash as string | null | undefined) ?? null,
    protected: Boolean(obj.Protected),
    deletePending: Boolean(obj.DeletePending),
    instantiationInfo:
      (obj.InstantiationInfo as string | null | undefined) ?? null,
    hasSkinIni,
    files,
  };
}

/**
 * Mirror all lazer Skin rows into the local mirror (metadata + named file hashes).
 */
export function syncRealmSkinsFromRealm(db: Db, realm: Realm): RealmSkinSyncCounts {
  const syncedAt = new Date();
  const seenIds = new Set<string>();
  const pending: SkinPending[] = [];

  for (const obj of realm.objects("Skin")) {
    const mapped = mapSkinFromRealm(obj as RealmObj);
    if (!mapped) continue;
    seenIds.add(mapped.id);
    pending.push(mapped);
  }

  const existing = db
    .select({ id: realmSkins.id })
    .from(realmSkins)
    .all();

  return db.transaction((tx) => {
    let skinsUpserted = 0;
    let filesUpserted = 0;

    for (const skin of pending) {
      tx.insert(realmSkins)
        .values({
          id: skin.id,
          name: skin.name,
          creator: skin.creator,
          hash: skin.hash,
          protected: skin.protected,
          deletePending: skin.deletePending,
          instantiationInfo: skin.instantiationInfo,
          hasSkinIni: skin.hasSkinIni,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: realmSkins.id,
          set: {
            name: skin.name,
            creator: skin.creator,
            hash: skin.hash,
            protected: skin.protected,
            deletePending: skin.deletePending,
            instantiationInfo: skin.instantiationInfo,
            hasSkinIni: skin.hasSkinIni,
            syncedAt,
          },
        })
        .run();
      skinsUpserted += 1;

      tx.delete(realmSkinFiles)
        .where(eq(realmSkinFiles.skinId, skin.id))
        .run();

      if (skin.files.length === 0) continue;

      for (let i = 0; i < skin.files.length; i += FILE_CHUNK) {
        const chunk = skin.files.slice(i, i + FILE_CHUNK).map((f) => ({
          skinId: skin.id,
          filename: f.filename,
          fileHash: f.fileHash,
        }));
        tx.insert(realmSkinFiles).values(chunk).onConflictDoNothing().run();
        filesUpserted += chunk.length;
      }
    }

    const staleIds = existing
      .map((row) => row.id)
      .filter((id) => !seenIds.has(id));
    let skinsDeleted = 0;
    for (let i = 0; i < staleIds.length; i += FILE_CHUNK) {
      const chunk = staleIds.slice(i, i + FILE_CHUNK);
      tx.delete(realmSkinFiles)
        .where(inArray(realmSkinFiles.skinId, chunk))
        .run();
      const deleted = tx
        .delete(realmSkins)
        .where(inArray(realmSkins.id, chunk))
        .run();
      skinsDeleted += deleted.changes ?? chunk.length;
    }

    return { skinsUpserted, filesUpserted, skinsDeleted };
  });
}
