/**
 * Thin wrapper around @roxysu/db — the only module that imports the shared DB package.
 */
export {
  createDb,
  closeDb,
  eq,
  and,
  or,
  like,
  desc,
  asc,
  count,
  sql,
} from "@roxysu/db/client.bun";

export { beatmaps, beatmapSets, scores, settings } from "@roxysu/db/schema";

export { defaultDbPath, defaultDataDir } from "@roxysu/db/path";

export type { Db } from "@roxysu/db/types";
