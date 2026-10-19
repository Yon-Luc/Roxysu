/**
 * Skin file-map helpers shared by the skin fusion planner (client) and the
 * skin summary on `GET /api/skins` (server). Pure: no Node or DOM imports.
 *
 * A `SkinFiles` map is keyed by a safe relative path with `/` separators,
 * relative to the skin root (the folder that holds the shortest `skin.ini`).
 */
import { unzipSync } from "fflate";
import { sanitizeZipEntryPath } from "../zipEntryPath";

export type SkinFiles = Map<string, Uint8Array>;

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
export const AUDIO_EXTS = ["wav", "ogg", "mp3"] as const;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif)$/i;

/** Normalise an ini / layout reference (`7k\a\b`) to a `/` path without leading slashes. */
export function normalizeRef(ref: string): string {
  return ref
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

export function stripImageExt(path: string): string {
  return path.replace(IMAGE_EXT_RE, "");
}

export function imageExtOf(path: string): string {
  return IMAGE_EXT_RE.exec(path)?.[0] ?? "";
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Unzip an `.osk`, dropping zip-slip names and empty entries. */
export function unzipSkinFiles(data: Uint8Array): SkinFiles {
  const raw = unzipSync(data);
  const map: SkinFiles = new Map();
  for (const [path, bytes] of Object.entries(raw)) {
    if (!bytes || bytes.length === 0) continue;
    const safe = sanitizeZipEntryPath(path);
    if (!safe) continue;
    map.set(safe, bytes);
  }
  return map;
}

/** Path of the shortest `skin.ini` (fewest folders, then shortest string). */
export function findSkinIniPath(files: SkinFiles): string | null {
  const matches = [...files.keys()].filter(
    (k) => basename(k).toLowerCase() === "skin.ini",
  );
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.length - b.length,
  );
  return matches[0] ?? null;
}

/**
 * Re-key a file map relative to its skin root. Files outside the root are
 * dropped. Returns the original map when `skin.ini` is already at the root.
 */
export function rebaseToSkinRoot(files: SkinFiles): SkinFiles {
  const iniPath = findSkinIniPath(files);
  if (!iniPath) return files;
  const root = dirname(iniPath);
  if (!root) return files;
  const prefix = `${root}/`;
  const out: SkinFiles = new Map();
  for (const [path, bytes] of files) {
    if (path.startsWith(prefix)) out.set(path.slice(prefix.length), bytes);
  }
  return out;
}

/** Case-insensitive path lookup (lazer and osu!stable resolve names case-insensitively). */
export class PathIndex {
  private readonly byLower = new Map<string, string>();

  constructor(readonly files: SkinFiles) {
    for (const path of files.keys()) {
      const lower = path.toLowerCase();
      if (!this.byLower.has(lower)) this.byLower.set(lower, path);
    }
  }

  /** Real path for a case-insensitive path, or null. */
  find(path: string): string | null {
    return this.byLower.get(path.toLowerCase()) ?? null;
  }

  get(path: string): Uint8Array | null {
    const real = this.find(path);
    return real ? (this.files.get(real) ?? null) : null;
  }

  has(path: string): boolean {
    return this.byLower.has(path.toLowerCase());
  }
}

export type ResolvedImage = {
  /** Reference without extension, normalised (`7k/a/mania-note1`). */
  base: string;
  /** Every existing file that belongs to this reference (SD, @2x, frames). */
  files: Array<{ path: string; bytes: Uint8Array }>;
};

const MAX_FRAMES = 64;

/**
 * Resolve an ini image reference to every file that belongs to it:
 * `name.ext`, `name@2x.ext` and animation frames `name-0.ext`, `name-1.ext`...
 * (with their `@2x` pairs). SD and HD variants always come from the same
 * skin, which keeps a pair from being split across donors.
 *
 * Returns null when no variant exists.
 */
export function resolveImageRef(
  index: PathIndex,
  ref: string,
): ResolvedImage | null {
  const base = stripImageExt(normalizeRef(ref));
  if (!base) return null;
  const files: ResolvedImage["files"] = [];
  const seen = new Set<string>();

  const take = (stem: string): boolean => {
    let found = false;
    for (const suffix of ["@2x", ""]) {
      for (const ext of IMAGE_EXTS) {
        const real = index.find(`${stem}${suffix}.${ext}`);
        if (!real || seen.has(real)) continue;
        const bytes = index.files.get(real);
        if (!bytes) continue;
        seen.add(real);
        files.push({ path: real, bytes });
        found = true;
      }
    }
    return found;
  };

  take(base);
  for (let n = 0; n < MAX_FRAMES; n += 1) {
    if (!take(`${base}-${n}`)) break;
  }
  return files.length > 0 ? { base, files } : null;
}

/** First candidate reference that resolves, with the candidate that matched. */
export function resolveFirstImage(
  index: PathIndex,
  candidates: string[],
): (ResolvedImage & { candidate: string }) | null {
  for (const candidate of candidates) {
    const hit = resolveImageRef(index, candidate);
    if (hit) return { ...hit, candidate };
  }
  return null;
}
