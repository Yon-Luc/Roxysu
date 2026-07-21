import path from "node:path";
import os from "node:os";
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

/**
 * Default osu!lazer data directory for the current OS.
 * Windows: `%APPDATA%\osu`
 * macOS: `~/Library/Application Support/osu`
 * Linux: `~/.local/share/osu`
 */
export function platformDefaultOsuDataPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  if (platform === "win32") {
    const appData =
      env.APPDATA?.trim() || path.join(homedir(), "AppData", "Roaming");
    return path.join(appData, "osu");
  }
  if (platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "osu");
  }
  return path.join(homedir(), ".local", "share", "osu");
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
export function validateOsuDataPath(
  raw: string,
): { ok: true; path: string } | { ok: false; error: string } {
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
