import { readFileSync } from "node:fs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { realmSkinFiles, realmSkins } from "@roxysu/db/schema";
import { zipSync } from "fflate";
import { dbPlugin } from "../db-runtime";
import { resolveLazerFilePath } from "../shared/lazer-files";
import { sanitizeZipEntryPath } from "../shared/zipEntryPath";
import { summarizeSkin, type SkinSummary } from "../shared/skinFusion/summary";

/** skin.ini key counts by skin id + content hash (the lazer store is content-addressed). */
const keyCountMemo = new Map<string, number[]>();

function readSkinIni(
  files: Array<{ filename: string; fileHash: string }>,
): Uint8Array | null {
  const ini = files
    .filter((f) => (f.filename.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase() === "skin.ini")
    .sort((a, b) => a.filename.split(/[\\/]/).length - b.filename.split(/[\\/]/).length)[0];
  if (!ini) return null;
  const path = resolveLazerFilePath(ini.fileHash);
  if (!path) return null;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

function summaryFor(
  skinId: string,
  contentHash: string | null,
  files: Array<{ filename: string; fileHash: string }>,
): SkinSummary {
  const memoKey = contentHash ? `${skinId}:${contentHash}` : null;
  const cached = memoKey ? keyCountMemo.get(memoKey) : undefined;
  if (cached) {
    return { ...summarizeSkin(files.map((f) => f.filename)), keyCounts: cached };
  }
  const summary = summarizeSkin(files.map((f) => f.filename), readSkinIni(files));
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

    return {
      items: rows.map((row) => {
        const summary = summaryFor(row.id, row.hash, filesBySkin.get(row.id) ?? []);
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
    };
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

      const zipEntries: Record<string, Uint8Array> = {};
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
          zipEntries[entryName] = new Uint8Array(readFileSync(path));
        } catch {
          missing.push(file.filename);
        }
      }

      const hasIni = Object.keys(zipEntries).some(
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

      if (Object.keys(zipEntries).length === 0) {
        set.status = 404;
        return { error: "No skin files could be read from the lazer store" };
      }

      const zipped = zipSync(zipEntries);
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
