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
  inArray,
} from "@roxysu/db/client.bun";

export {
  beatmaps,
  beatmapSets,
  scores,
  settings,
  mastery,
  collections,
  realmCollections,
  realmCollectionHashes,
  beatmapManiaRatings,
  beatmapPatternAnalysis,
  beatmapDanRatings,
} from "@roxysu/db/schema";

export { defaultDbPath, defaultDataDir } from "@roxysu/db/path";

export type { Db } from "@roxysu/db/types";
