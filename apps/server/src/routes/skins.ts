import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { realmSkinFiles, realmSkins } from "@roxysu/db/schema";
import { zip, zipSync } from "fflate";
import { dbPlugin } from "../db-runtime";
import { resolveLazerFilePath } from "../shared/lazer-files";
import { sanitizeZipEntryPath } from "../shared/zipEntryPath";
import { summarizeSkin, type SkinSummary } from "../shared/skinFusion/summary";

/** skin.ini key counts by skin id + content hash (the lazer store is content-addressed). */
const keyCountMemo = new Map<string, number[]>();

async function readSkinIni(
  files: Array<{ filename: string; fileHash: string }>,
): Promise<Uint8Array | null> {
  const ini = files
    .filter((f) => (f.filename.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase() === "skin.ini")
    .sort((a, b) => a.filename.split(/[\\/]/).length - b.filename.split(/[\\/]/).length)[0];
  if (!ini) return null;
  const path = resolveLazerFilePath(ini.fileHash);
  if (!path) return null;
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

async function summaryFor(
  skinId: string,
  contentHash: string | null,
  files: Array<{ filename: string; fileHash: string }>,
): Promise<SkinSummary> {
  const memoKey = contentHash ? `${skinId}:${contentHash}` : null;
  const cached = memoKey ? keyCountMemo.get(memoKey) : undefined;
  if (cached) {
    return { ...summarizeSkin(files.map((f) => f.filename)), keyCounts: cached };
  }
  const summary = summarizeSkin(
    files.map((f) => f.filename),
    await readSkinIni(files),
  );
  if (memoKey) keyCountMemo.set(memoKey, summary.keyCounts);
  return summary;
}

function sanitizeZipStem(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "skin";
}

/**
 * Bounded archive memo: re-exporting the same skin should not re-zip it. The
 * key is the included (entry name, lazer content hash) list, so a store change
 * invalidates it; entries are capped by count and total footprint.
 */
const ARCHIVE_CACHE_MAX_ENTRIES = 4;
const ARCHIVE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const ARCHIVE_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const archiveCache = new Map<string, Uint8Array>();
let archiveCacheBytes = 0;

function archiveCacheKey(included: Array<{ name: string; hash: string }>): string {
  return included
    .map((entry) => `${entry.name}\0${entry.hash}`)
    .sort()
    .join("\0");
}

function readArchiveCache(key: string): Uint8Array | null {
  const hit = archiveCache.get(key);
  if (!hit) return null;
  // Refresh LRU order.
  archiveCache.delete(key);
  archiveCache.set(key, hit);
  return hit;
}

function writeArchiveCache(key: string, bytes: Uint8Array): void {
  if (bytes.byteLength > ARCHIVE_CACHE_MAX_ENTRY_BYTES) return;
  const previous = archiveCache.get(key);
  if (previous) {
    archiveCache.delete(key);
    archiveCacheBytes -= previous.byteLength;
  }
  archiveCache.set(key, bytes);
  archiveCacheBytes += bytes.byteLength;
  while (
    archiveCache.size > ARCHIVE_CACHE_MAX_ENTRIES ||
    archiveCacheBytes > ARCHIVE_CACHE_MAX_BYTES
  ) {
    const oldest = archiveCache.keys().next();
    if (oldest.done) break;
    const evicted = archiveCache.get(oldest.value);
    archiveCache.delete(oldest.value);
    if (evicted) archiveCacheBytes -= evicted.byteLength;
  }
}

/**
 * fflate's async `zip` offloads large entries to a worker so the request does
 * not block the event loop; fall back to the sync encoder where no worker is
 * available (the output is the same archive format either way).
 */
async function zipEntries(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      zip(entries, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  } catch {
    return zipSync(entries);
  }
}

export const skinRoutes = new Elysia({ prefix: "/skins" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const rows = await db
      .select({
        id: realmSkins.id,
        name: realmSkins.name,
        creator: realmSkins.creator,
        hash: realmSkins.hash,
        instantiationInfo: realmSkins.instantiationInfo,
      })
      .from(realmSkins)
      .where(
        and(eq(realmSkins.deletePending, false), eq(realmSkins.hasSkinIni, true)),
      )
      .orderBy(asc(realmSkins.name));

    const filesBySkin = new Map<string, Array<{ filename: string; fileHash: string }>>();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const fileRows = await db
        .select({
          skinId: realmSkinFiles.skinId,
          filename: realmSkinFiles.filename,
          fileHash: realmSkinFiles.fileHash,
        })
        .from(realmSkinFiles)
        .where(inArray(realmSkinFiles.skinId, chunk));
      for (const f of fileRows) {
        const list = filesBySkin.get(f.skinId) ?? [];
        list.push({ filename: f.filename, fileHash: f.fileHash });
        filesBySkin.set(f.skinId, list);
      }
    }

    const items = await Promise.all(
      rows.map(async (row) => {
        const summary = await summaryFor(
          row.id,
          row.hash,
          filesBySkin.get(row.id) ?? [],
        );
        return {
          id: row.id,
          name: row.name?.trim() || "Unnamed skin",
          creator: row.creator?.trim() || null,
          instantiationInfo: row.instantiationInfo,
          hasAssets: summary.hasAssets,
          hasLayout: summary.hasLayout,
          rulesets: summary.rulesets,
          keyCounts: summary.keyCounts,
        };
      }),
    );

    return { items };
  })
  .get(
    "/:id/archive",
    async ({ db, params, set }) => {
      const [skin] = await db
        .select({
          id: realmSkins.id,
          name: realmSkins.name,
          deletePending: realmSkins.deletePending,
          hasSkinIni: realmSkins.hasSkinIni,
        })
        .from(realmSkins)
        .where(eq(realmSkins.id, params.id))
        .limit(1);

      if (!skin || skin.deletePending || !skin.hasSkinIni) {
        set.status = 404;
        return { error: "Skin not found" };
      }

      const files = await db
        .select({
          filename: realmSkinFiles.filename,
          fileHash: realmSkinFiles.fileHash,
        })
        .from(realmSkinFiles)
        .where(eq(realmSkinFiles.skinId, skin.id));

      if (files.length === 0) {
        set.status = 404;
        return { error: "Skin has no files" };
      }

      const entries: Record<string, Uint8Array> = {};
      const included: Array<{ name: string; hash: string }> = [];
      const missing: string[] = [];

      for (const file of files) {
        // Realm filenames are untrusted: store only a safe relative path.
        const entryName = sanitizeZipEntryPath(file.filename);
        if (!entryName) continue;
        const path = resolveLazerFilePath(file.fileHash);
        if (!path) {
          missing.push(file.filename);
          continue;
        }
        try {
          entries[entryName] = new Uint8Array(await readFile(path));
          included.push({ name: entryName, hash: file.fileHash });
        } catch {
          missing.push(file.filename);
        }
      }

      const hasIni = Object.keys(entries).some(
        (name) => name.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === "skin.ini",
      );
      if (!hasIni) {
        set.status = 404;
        return {
          error:
            missing.length > 0
              ? `Skin files missing from lazer store (${missing.length} missing), including skin.ini`
              : "skin.ini missing from skin files",
        };
      }

      if (Object.keys(entries).length === 0) {
        set.status = 404;
        return { error: "No skin files could be read from the lazer store" };
      }

      const cacheKey = archiveCacheKey(included);
      let zipped = readArchiveCache(cacheKey);
      if (!zipped) {
        zipped = await zipEntries(entries);
        writeArchiveCache(cacheKey, zipped);
      }

      const stem = sanitizeZipStem(skin.name ?? "skin");
      return new Response(Buffer.from(zipped), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${stem}.osk"`,
          "cache-control": "no-store",
          ...(missing.length > 0
            ? { "x-roxysu-missing-files": String(missing.length) }
            : {}),
        },
      });
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
