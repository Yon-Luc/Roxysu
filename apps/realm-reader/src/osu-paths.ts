import { eq, settings, type Db } from "@roxysu/db/client.node";
import {
  OSU_DATA_PATH_SETTING_KEY,
  resolveOsuDataPath,
  resolveRealmPath,
} from "@roxysu/osu-paths";

export {
  OSU_DATA_PATH_SETTING_KEY,
  platformDefaultOsuDataPath,
  resolveRealmPath,
} from "@roxysu/osu-paths";

/** Resolve data path string (settings/env/default) without source metadata. */
export function resolveOsuDataPathString(
  settingsOverride: string | null | undefined,
): string {
  return resolveOsuDataPath(settingsOverride).resolved;
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

  const dataPath = resolveOsuDataPath(row?.value).resolved;
  return resolveRealmPath(dataPath);
}
