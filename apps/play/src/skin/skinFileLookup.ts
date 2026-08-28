import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripExt(value: string): string {
  return value.replace(/\.(png|jpe?g|gif)$/i, "");
}

function joinPath(root: string, name: string): string {
  const cleaned = normalizePath(name);
  if (!root) return cleaned;
  return path.join(root, cleaned);
}

function findCaseInsensitiveFile(candidate: string): string | null {
  if (existsSync(candidate)) return candidate;

  const dir = path.dirname(candidate);
  const base = path.basename(candidate);
  if (!existsSync(dir)) return null;

  try {
    const entries = readdirSync(dir);
    const match = entries.find(
      (entry) => entry.toLowerCase() === base.toLowerCase(),
    );
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export function lookupSkinImagePath(root: string, name: string): string | null {
  const raw = normalizePath(name);
  const noExt = stripExt(raw);
  const bases = [joinPath(root, noExt), joinPath(root, raw), joinPath("", noExt)];

  const seen = new Set<string>();
  for (const base of bases) {
    for (const ext of IMAGE_EXTS) {
      for (const suffix of [`@2x.${ext}`, `.${ext}`] as const) {
        const candidate = `${base}${suffix}`;
        const lower = candidate.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        const resolved = findCaseInsensitiveFile(candidate);
        if (resolved) return resolved;
      }
    }
  }

  const needle = path.basename(noExt).toLowerCase();
  if (!needle) return null;

  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4 || !existsSync(dir)) return null;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      const lower = entry.toLowerCase();
      for (const ext of IMAGE_EXTS) {
        if (lower === `${needle}.${ext}` || lower === `${needle}@2x.${ext}`) {
          return full;
        }
      }
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        if (!statSyncIsDir(full)) continue;
        const nested = walk(full, depth + 1);
        if (nested) return nested;
      } catch {
        continue;
      }
    }
    return null;
  };

  return walk(root, 0);
}

function statSyncIsDir(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

export function resolveNamedSkinImage(
  root: string,
  names: string[],
): string | null {
  for (const name of names) {
    const resolved = lookupSkinImagePath(root, name);
    if (resolved) return resolved;
  }
  return null;
}

import { pathToFileURL } from "node:url";

export function toSkinAssetUrl(filePath: string): string {
  if (filePath.startsWith("data:")) return filePath;
  return pathToFileURL(filePath).href;
}
