import path from "node:path";
import { existsSync } from "node:fs";
import { getOsuDataPath } from "./osu-paths";

export { getOsuDataPath } from "./osu-paths";

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function isLazerFileHash(hash: string): boolean {
  return SHA256_HEX.test(hash);
}

/**
 * Resolve a SHA-256 to lazer's hashed files/ path:
 * files/{h[0]}/{h[0:2]}/{hash}
 */
export function resolveLazerFilePath(
  hash: string,
  osuDataPath = getOsuDataPath(),
): string | null {
  if (!isLazerFileHash(hash)) return null;
  const h = hash.toLowerCase();
  return path.join(osuDataPath, "files", h[0]!, h.slice(0, 2), h);
}

export function lazerFileExists(
  hash: string,
  osuDataPath = getOsuDataPath(),
): boolean {
  const filePath = resolveLazerFilePath(hash, osuDataPath);
  return filePath != null && existsSync(filePath);
}
