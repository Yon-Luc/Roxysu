import path from "node:path";
import { existsSync, statSync } from "node:fs";

/** Settings KV key for the osu!lazer data directory override. */
export const OSU_DATA_PATH_SETTING_KEY = "paths.osu_data";

export type PathSource = "env" | "settings" | "default";

export type OsuPathStatus = {
  exists: boolean;
  hasRealm: boolean;
  hasFiles: boolean;
};

export type ResolvedOsuPaths = {
  /** Configured settings override (null when unset / cleared). */
  osuDataPath: string | null;
  resolvedOsuDataPath: string;
  resolvedRealmPath: string;
  source: PathSource;
  status: OsuPathStatus;
};

/** Linux default: `$HOME/.local/share/osu`. */
export function platformDefaultOsuDataPath(): string {
  return path.join(process.env.HOME ?? "", ".local/share/osu");
}

/**
 * Resolve the lazer data directory.
 * Precedence: OSU_DATA_PATH / REALM_PATH env → settings override → platform default.
 */
export function resolveOsuDataPath(settingsOverride: string | null | undefined): {
  resolved: string;
  source: PathSource;
} {
  if (process.env.OSU_DATA_PATH) {
    return { resolved: process.env.OSU_DATA_PATH, source: "env" };
  }
  if (process.env.REALM_PATH) {
    return { resolved: path.dirname(process.env.REALM_PATH), source: "env" };
  }
  const trimmed = settingsOverride?.trim();
  if (trimmed) {
    return { resolved: trimmed, source: "settings" };
  }
  return { resolved: platformDefaultOsuDataPath(), source: "default" };
}

/** Prefer REALM_PATH env, else `{osuDataPath}/client.realm`. */
export function resolveRealmPath(osuDataPath: string): string {
  if (process.env.REALM_PATH) return process.env.REALM_PATH;
  return path.join(osuDataPath, "client.realm");
}

export function probeOsuPathStatus(osuDataPath: string): OsuPathStatus {
  let exists = false;
  try {
    exists = existsSync(osuDataPath) && statSync(osuDataPath).isDirectory();
  } catch {
    exists = false;
  }
  const realmPath = resolveRealmPath(osuDataPath);
  return {
    exists,
    hasRealm: existsSync(realmPath),
    hasFiles: existsSync(path.join(osuDataPath, "files")),
  };
}

export function buildResolvedOsuPaths(
  settingsOverride: string | null | undefined,
): ResolvedOsuPaths {
  const override =
    settingsOverride?.trim() && settingsOverride.trim().length > 0
      ? settingsOverride.trim()
      : null;
  const { resolved, source } = resolveOsuDataPath(override);
  return {
    osuDataPath: override,
    resolvedOsuDataPath: resolved,
    resolvedRealmPath: resolveRealmPath(resolved),
    source,
    status: probeOsuPathStatus(resolved),
  };
}

/** Validate a user-supplied data directory before saving. */
export function validateOsuDataPath(raw: string): { ok: true; path: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Path cannot be empty" };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "Path must be absolute" };
  }
  try {
    if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) {
      return { ok: false, error: "Directory does not exist" };
    }
  } catch {
    return { ok: false, error: "Directory does not exist" };
  }
  const realm = path.join(trimmed, "client.realm");
  if (!existsSync(realm)) {
    return {
      ok: false,
      error: `No client.realm found at ${realm}`,
    };
  }
  return { ok: true, path: trimmed };
}

/** In-process cache of the settings override (env still wins at resolve time). */
let cachedOverride: string | null = null;

export function getCachedOsuDataOverride(): string | null {
  return cachedOverride;
}

export function setCachedOsuDataOverride(override: string | null): void {
  cachedOverride = override?.trim() ? override.trim() : null;
}

/** Effective data path for covers / audio / beatmaps (respects env + cache). */
export function getOsuDataPath(): string {
  return resolveOsuDataPath(cachedOverride).resolved;
}
