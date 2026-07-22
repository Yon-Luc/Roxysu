/** Shared SQL fragments for beatmap list queries using the query-language alias contract. */

export const BEATMAP_SET_JOIN =
  "LEFT JOIN beatmap_sets bs ON bs.id = b.set_id";

export function beatmapFilterWhere(filterSql: string): string {
  return `WHERE b.hidden = 0 AND COALESCE(bs.delete_pending, 0) = 0 AND (${filterSql})`;
}
