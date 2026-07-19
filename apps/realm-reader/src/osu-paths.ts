import path from "node:path";
import { eq, settings, type Db } from "@roxysu/db/client.node";

/** Mirrors apps/server/src/shared/osu-paths.ts */
export const OSU_DATA_PATH_SETTING_KEY = "paths.osu_data";

export function platformDefaultOsuDataPath(): string {
  return path.join(process.env.HOME ?? "", ".local/share/osu");
}

/**
 * Resolve the lazer data directory.
 * Precedence: OSU_DATA_PATH / REALM_PATH env → settings override → platform default.
 */
export function resolveOsuDataPath(settingsOverride: string | null | undefined): string {
  if (process.env.OSU_DATA_PATH) return process.env.OSU_DATA_PATH;
  if (process.env.REALM_PATH) return path.dirname(process.env.REALM_PATH);
  const trimmed = settingsOverride?.trim();
  if (trimmed) return trimmed;
  return platformDefaultOsuDataPath();
}

/** Prefer REALM_PATH env, else `{osuDataPath}/client.realm`. */
export function resolveRealmPath(osuDataPath: string): string {
  if (process.env.REALM_PATH) return process.env.REALM_PATH;
  return path.join(osuDataPath, "client.realm");
}

/** Read settings override from SQLite and resolve the realm path for this sync cycle. */
export function resolveRealmPathFromDb(db: Db): string {
  if (process.env.REALM_PATH) return process.env.REALM_PATH;

  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY))
    .limit(1)
    .get();

  const dataPath = resolveOsuDataPath(row?.value);
  return resolveRealmPath(dataPath);
}
