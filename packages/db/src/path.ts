import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Platform default Roxysu data directory (desktop / packaged installs).
 * Windows: `%APPDATA%\Roxysu`
 * macOS: `~/Library/Application Support/Roxysu`
 * Linux: `~/.local/share/roxysu`
 */
export function platformDefaultRoxysuDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  if (platform === "win32") {
    const appData =
      env.APPDATA?.trim() || path.join(homedir(), "AppData", "Roaming");
    return path.join(appData, "Roxysu");
  }
  if (platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Roxysu");
  }
  return path.join(homedir(), ".local", "share", "roxysu");
}

function monorepoServerDataDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../apps/server");
}

/** True when running the Electron / Node product path (not Bun `bun run dev`). */
export function isDesktopRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.ROXYSU_DESKTOP === "1" ||
    env.ROXYSU_DESKTOP === "true" ||
    Boolean(env.ELECTRON_RUN_AS_NODE) ||
    Boolean(env.ROXYSU_DATA_DIR?.trim())
  );
}

/**
 * Directory for Roxysu SQLite + realm backups.
 * Precedence: `ROXYSU_DATA_DIR` → desktop platform default → monorepo `apps/server`.
 */
export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.ROXYSU_DATA_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (isDesktopRuntime(env)) return platformDefaultRoxysuDataDir(process.platform, env);
  return monorepoServerDataDir();
}

/**
 * Canonical Roxysu SQLite path shared by server and realm-reader.
 * Override with `DB_PATH`. Default: `{dataDir}/data.sqlite`.
 */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DB_PATH?.trim()) return env.DB_PATH.trim();
  return path.join(defaultDataDir(env), "data.sqlite");
}
