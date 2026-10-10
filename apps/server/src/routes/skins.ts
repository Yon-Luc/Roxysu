import { readFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { realmSkinFiles, realmSkins } from "@roxysu/db/schema";
import { zipSync } from "fflate";
import { dbPlugin } from "../db-runtime";
import { resolveLazerFilePath } from "../shared/lazer-files";

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
      })
      .from(realmSkins)
      .where(
        and(eq(realmSkins.deletePending, false), eq(realmSkins.hasSkinIni, true)),
      )
      .orderBy(asc(realmSkins.name));

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name?.trim() || "Unnamed skin",
        creator: row.creator?.trim() || null,
      })),
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
        const path = resolveLazerFilePath(file.fileHash);
        if (!path) {
          missing.push(file.filename);
          continue;
        }
        try {
          zipEntries[file.filename] = new Uint8Array(readFileSync(path));
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
