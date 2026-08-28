import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import {
  decodeSkinIniBytes,
  keyImageCandidates,
  noteImageCandidates,
  parseSkinIni,
  resolveManiaSection,
  stageImageCandidates,
} from "../integrations/osu-skin-ini";
import { DEFAULT_PLAYFIELD_SKIN } from "./defaultSkin";
import type { PlayfieldSkin, PlayfieldSkinSprites } from "./PlayfieldSkin";
import { readImageDimensions } from "./readImageDimensions";
import { resolveNamedSkinImage } from "./skinFileLookup";
import { maniaSectionToLayout, type ImportedManiaLayout } from "./skinLayout";
import {
  listInstalledSkins,
  readSkinDisplayName,
  type SkinCatalogEntry,
} from "./skinPaths";

export type { SkinCatalogEntry };

export type SkinLoadResult =
  | { ok: true; skin: PlayfieldSkin; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

type FileMap = Map<string, Uint8Array>;

const LANES = 7;

function indexSpriteSizes(
  paths: Iterable<string | null | undefined>,
): Record<string, { w: number; h: number }> {
  const sizes: Record<string, { w: number; h: number }> = {};
  for (const filePath of paths) {
    if (!filePath || sizes[filePath]) continue;
    const dims = readImageDimensions(filePath);
    if (dims) sizes[filePath] = dims;
  }
  return sizes;
}

function collectSpriteSizes(sprites: PlayfieldSkinSprites): Record<string, { w: number; h: number }> {
  return indexSpriteSizes([
    ...sprites.notes,
    ...sprites.bodies,
    ...sprites.tails,
    ...sprites.keysUp,
    ...sprites.keysDown,
    sprites.stageLeft,
    sprites.stageRight,
  ]);
}

function normalizeArchivePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function unzipSkinArchive(data: Uint8Array): FileMap {
  const files = unzipSync(data);
  const map: FileMap = new Map();
  for (const [entryPath, bytes] of Object.entries(files)) {
    if (!bytes || bytes.length === 0) continue;
    map.set(normalizeArchivePath(entryPath), bytes);
  }
  return map;
}

function findSkinIniPathInMap(files: FileMap): string | null {
  const matches = [...files.keys()].filter((key) =>
    key.toLowerCase().endsWith("skin.ini"),
  );
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.length - b.length,
  );
  return matches[0] ?? null;
}

function dirnameArchivePath(entryPath: string): string {
  const index = entryPath.lastIndexOf("/");
  return index < 0 ? "" : entryPath.slice(0, index);
}

function lookupImageInMap(
  files: FileMap,
  root: string,
  name: string,
): string | null {
  const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
  const raw = normalizeArchivePath(name);
  const noExt = raw.replace(/\.(png|jpe?g|gif)$/i, "");
  const bases = [
    root ? `${root}/${noExt}` : noExt,
    root ? `${root}/${raw}` : raw,
    noExt,
  ];

  const seen = new Set<string>();
  for (const base of bases) {
    for (const ext of IMAGE_EXTS) {
      for (const suffix of [`@2x.${ext}`, `.${ext}`] as const) {
        const candidate = `${base}${suffix}`.toLowerCase();
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        for (const [filePath, bytes] of files) {
          if (filePath.toLowerCase() === candidate) {
            return writeArchiveBytesToCache(filePath, bytes);
          }
        }
      }
    }
  }
  return null;
}

const archiveCacheDir = path.join(os.tmpdir(), "roxysu-play-skin-cache");

function writeArchiveBytesToCache(relativePath: string, bytes: Uint8Array): string {
  const safeName = relativePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const outPath = path.join(archiveCacheDir, safeName);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
  return outPath;
}

function extractOskToCache(oskPath: string): string {
  const stat = statSync(oskPath);
  const signature = `${stat.size}:${stat.mtimeMs}`;
  const cacheKey = createHash("sha256")
    .update(oskPath)
    .update(signature)
    .digest("hex")
    .slice(0, 24);
  const cacheDir = path.join(archiveCacheDir, cacheKey);
  const marker = path.join(cacheDir, ".extracted");

  if (existsSync(marker)) {
    return cacheDir;
  }

  const bytes = readFileSync(oskPath);
  const files = unzipSkinArchive(bytes);
  mkdirSync(cacheDir, { recursive: true });

  for (const [entryPath, entryBytes] of files) {
    if (entryPath.endsWith("/")) continue;
    const outPath = path.join(cacheDir, entryPath);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, entryBytes);
  }

  writeFileSync(marker, signature);
  return cacheDir;
}

function resolveSkinRoot(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`Skin path does not exist: ${resolved}`);
  }

  if (resolved.toLowerCase().endsWith(".osk")) {
    return extractOskToCache(resolved);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error("Skin path must be a folder or .osk archive");
  }

  return resolved;
}

function buildSpritesFromDisk(
  root: string,
  keys: number,
  warnings: string[],
): PlayfieldSkinSprites {
  const iniPath = path.join(root, "skin.ini");
  const section = resolveManiaSection(
    parseSkinIni(decodeSkinIniBytes(readFileSync(iniPath))).mania,
    keys,
  );

  const notes: (string | null)[] = [];
  const bodies: (string | null)[] = [];
  const tails: (string | null)[] = [];
  const keysUp: (string | null)[] = [];
  const keysDown: (string | null)[] = [];

  for (let column = 0; column < keys; column += 1) {
    notes.push(
      resolveNamedSkinImage(root, noteImageCandidates(section, column, "")) ??
        null,
    );
    bodies.push(
      resolveNamedSkinImage(root, noteImageCandidates(section, column, "H")) ??
        null,
    );
    tails.push(
      resolveNamedSkinImage(root, noteImageCandidates(section, column, "L")) ??
        null,
    );
    keysUp.push(
      resolveNamedSkinImage(root, keyImageCandidates(section, column, false)) ??
        null,
    );
    keysDown.push(
      resolveNamedSkinImage(root, keyImageCandidates(section, column, true)) ??
        null,
    );
  }

  const stageLeft =
    resolveNamedSkinImage(root, stageImageCandidates(section, "left")) ?? null;
  const stageRight =
    resolveNamedSkinImage(root, stageImageCandidates(section, "right")) ?? null;

  if (notes.every((value) => value == null)) {
    warnings.push("No mania note images were found for 7K — using default note colors.");
  }

  return {
    notes,
    bodies,
    tails,
    keysUp,
    keysDown,
    stageLeft,
    stageRight,
  };
}

function buildSpritesFromArchive(
  files: FileMap,
  iniPath: string,
  keys: number,
  warnings: string[],
): PlayfieldSkinSprites {
  const iniBytes = files.get(iniPath);
  if (!iniBytes) {
    throw new Error("skin.ini is missing from the archive");
  }

  const root = dirnameArchivePath(iniPath);
  const section = resolveManiaSection(
    parseSkinIni(decodeSkinIniBytes(iniBytes)).mania,
    keys,
  );

  const resolve = (names: string[]) => {
    for (const name of names) {
      const resolved = lookupImageInMap(files, root, name);
      if (resolved) return resolved;
    }
    return null;
  };

  const notes: (string | null)[] = [];
  const bodies: (string | null)[] = [];
  const tails: (string | null)[] = [];
  const keysUp: (string | null)[] = [];
  const keysDown: (string | null)[] = [];

  for (let column = 0; column < keys; column += 1) {
    notes.push(resolve(noteImageCandidates(section, column, "")));
    bodies.push(resolve(noteImageCandidates(section, column, "H")));
    tails.push(resolve(noteImageCandidates(section, column, "L")));
    keysUp.push(resolve(keyImageCandidates(section, column, false)));
    keysDown.push(resolve(keyImageCandidates(section, column, true)));
  }

  if (notes.every((value) => value == null)) {
    warnings.push("No mania note images were found for 7K — using default note colors.");
  }

  return {
    notes,
    bodies,
    tails,
    keysUp,
    keysDown,
    stageLeft: resolve(stageImageCandidates(section, "left")),
    stageRight: resolve(stageImageCandidates(section, "right")),
  };
}

function finalizeSkin(
  partial: Omit<PlayfieldSkin, "spriteSizes"> & {
    sprites: PlayfieldSkinSprites | null;
  },
  maniaLayout: ImportedManiaLayout | null,
): PlayfieldSkin {
  const sprites = partial.sprites;
  return {
    ...partial,
    maniaLayout,
    spriteSizes: sprites ? collectSpriteSizes(sprites) : {},
  };
}

function loadSkinFromRoot(root: string, keys: number): SkinLoadResult {
  const warnings: string[] = [];
  const iniPath = path.join(root, "skin.ini");
  if (!existsSync(iniPath)) {
    return { ok: false, error: "skin.ini was not found in the skin folder", warnings };
  }

  const parsed = parseSkinIni(decodeSkinIniBytes(readFileSync(iniPath)));
  const section = resolveManiaSection(parsed.mania, keys);
  const sprites = buildSpritesFromDisk(root, keys, warnings);
  const name = parsed.name.trim() || readSkinDisplayName(root);

  return {
    ok: true,
    skin: finalizeSkin(
      {
        ...DEFAULT_PLAYFIELD_SKIN,
        id: root,
        name,
        sprites,
        sourcePath: root,
      },
      maniaSectionToLayout(section),
    ),
    warnings,
  };
}

function loadSkinFromOsk(oskPath: string, keys: number): SkinLoadResult {
  const warnings: string[] = [];
  const bytes = readFileSync(oskPath);
  const files = unzipSkinArchive(bytes);
  const iniPath = findSkinIniPathInMap(files);
  if (!iniPath) {
    return { ok: false, error: "No skin.ini found in the .osk archive", warnings };
  }

  const parsed = parseSkinIni(decodeSkinIniBytes(files.get(iniPath)!));
  const section = resolveManiaSection(parsed.mania, keys);
  const sprites = buildSpritesFromArchive(files, iniPath, keys, warnings);

  return {
    ok: true,
    skin: finalizeSkin(
      {
        ...DEFAULT_PLAYFIELD_SKIN,
        id: path.resolve(oskPath),
        name: parsed.name.trim() || path.basename(oskPath, ".osk"),
        sprites,
        sourcePath: path.resolve(oskPath),
      },
      maniaSectionToLayout(section),
    ),
    warnings,
  };
}

export class SkinLoader {
  constructor(private readonly osuDataPath: string) {}

  listInstalled(): SkinCatalogEntry[] {
    return listInstalledSkins(this.osuDataPath);
  }

  load(skinPath: string | null | undefined, keys = LANES): SkinLoadResult {
    if (!skinPath?.trim()) {
      return { ok: true, skin: { ...DEFAULT_PLAYFIELD_SKIN }, warnings: [] };
    }

    try {
      const resolved = path.resolve(skinPath.trim());
      if (resolved.toLowerCase().endsWith(".osk")) {
        return loadSkinFromOsk(resolved, keys);
      }

      const root = resolveSkinRoot(resolved);
      return loadSkinFromRoot(root, keys);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load skin",
        warnings: [],
      };
    }
  }
}
