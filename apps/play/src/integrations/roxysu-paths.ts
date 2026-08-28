/**
 * Thin wrapper around @roxysu/osu-paths — the only module that imports path resolution.
 */
export {
  OSU_DATA_PATH_SETTING_KEY,
  buildResolvedOsuPaths,
  probeOsuPathStatus,
  resolveOsuDataPath,
  resolveRealmPath,
  type OsuPathStatus,
  type ResolvedOsuPaths,
} from "@roxysu/osu-paths";
