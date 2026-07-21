/**
 * Server wrappers around `@roxysu/osu-paths` — in-process settings override cache
 * for covers / audio / beatmap file resolution.
 */
export {
  OSU_DATA_PATH_SETTING_KEY,
  platformDefaultOsuDataPath,
  resolveOsuDataPath,
  resolveRealmPath,
  probeOsuPathStatus,
  buildResolvedOsuPaths,
  validateOsuDataPath,
  type PathSource,
  type OsuPathStatus,
  type ResolvedOsuPaths,
} from "@roxysu/osu-paths";

import { resolveOsuDataPath } from "@roxysu/osu-paths";

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
