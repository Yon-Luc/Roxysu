import { sql } from "drizzle-orm";
import { beatmaps } from "@roxysu/db/schema";

import { DANIEL_ALGORITHM } from "./computeDanielDan";

/** Correlated subselect for Daniel dan label (use where `beatmaps` is in scope). */
export function danielEstDiffSelect() {
  return sql<string | null>`(
    SELECT est_diff
    FROM beatmap_dan_ratings
    WHERE beatmap_id = ${beatmaps.id}
      AND algorithm = ${DANIEL_ALGORITHM}
  )`;
}

/** Correlated subselect for Daniel star rating (use where `beatmaps` is in scope). */
export function danielStarSelect() {
  return sql<number | null>`(
    SELECT sunny_star
    FROM beatmap_dan_ratings
    WHERE beatmap_id = ${beatmaps.id}
      AND algorithm = ${DANIEL_ALGORITHM}
  )`;
}
