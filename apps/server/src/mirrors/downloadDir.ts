import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync, statSync } from "node:fs";

/** Env override for where batch .osz downloads are written. */
export const BEATMAPS_DOWNLOAD_DIR_ENV = "BEATMAPS_DOWNLOAD_DIR";

/**
 * Default: `~/Downloads/beatmaps` (or `%USERPROFILE%\Downloads\beatmaps` on Windows).
 * Override with BEATMAPS_DOWNLOAD_DIR.
 */
export function resolveBeatmapsDownloadDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  const override = env[BEATMAPS_DOWNLOAD_DIR_ENV]?.trim();
  if (override) return path.resolve(override);

  const xdg = env.XDG_DOWNLOAD_DIR?.trim();
  if (xdg) return path.join(xdg, "beatmaps");

  return path.join(homedir(), "Downloads", "beatmaps");
}

export function ensureBeatmapsDownloadDir(dir: string = resolveBeatmapsDownloadDir()): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function probeBeatmapsDownloadDir(dir: string = resolveBeatmapsDownloadDir()): {
  path: string;
  exists: boolean;
  writableHint: boolean;
} {
  let exists = false;
  try {
    exists = existsSync(dir) && statSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  return {
    path: dir,
    exists,
    // Parent can usually be created; actual write is verified when a batch starts.
    writableHint: true,
  };
}

/** Safe on-disk name: `{id} Artist - Title.osz` */
export function beatmapSetArchiveFilename(set: {
  id: number;
  artist: string;
  title: string;
}): string {
  const raw = `${set.id} ${set.artist} - ${set.title}`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${raw || String(set.id)}.osz`;
}
