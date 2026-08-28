import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodeSkinIniBytes,
  parseSkinIni,
} from "../integrations/osu-skin-ini";

export type SkinCatalogEntry = {
  /** Stable filesystem path used as the catalog id. */
  id: string;
  name: string;
  path: string;
};

export function osuSkinSearchRoots(osuDataPath: string): string[] {
  const home = os.homedir();
  const candidates = [
    path.join(osuDataPath, "skins"),
    path.join(osuDataPath, "Skins"),
    path.join(home, ".local", "share", "osu", "Skins"),
    path.join(home, ".osu", "Skins"),
  ];

  const unique: string[] = [];
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}

export function readSkinIniAtFolder(folderPath: string): string | null {
  const iniPath = path.join(folderPath, "skin.ini");
  if (!existsSync(iniPath)) return null;
  try {
    return decodeSkinIniBytes(readFileSync(iniPath));
  } catch {
    return null;
  }
}

export function readSkinDisplayName(folderPath: string): string {
  const text = readSkinIniAtFolder(folderPath);
  if (!text) return path.basename(folderPath);
  const parsed = parseSkinIni(text);
  return parsed.name.trim() || path.basename(folderPath);
}

export function listInstalledSkins(osuDataPath: string): SkinCatalogEntry[] {
  const entries: SkinCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const root of osuSkinSearchRoots(osuDataPath)) {
    if (!existsSync(root)) continue;

    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }

    for (const name of names) {
      const folder = path.join(root, name);
      try {
        if (!statSync(folder).isDirectory()) continue;
        if (!readSkinIniAtFolder(folder)) continue;

        const realPath = path.resolve(folder);
        if (seen.has(realPath)) continue;
        seen.add(realPath);

        entries.push({
          id: realPath,
          path: realPath,
          name: readSkinDisplayName(folder),
        });
      } catch {
        continue;
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return entries;
}
