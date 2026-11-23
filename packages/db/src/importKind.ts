import { ne } from "drizzle-orm";
import { imports } from "./schema";

/**
 * SQL predicate selecting extraction cycles only.
 *
 * A `writeback` row records a manual Realm write (online score pull, score
 * transfer) so analytics can refresh the score ids it touched. It is **not** an
 * extraction cycle: it has no watermarks of its own and says nothing about
 * whether a real cycle is still running. Every reader that means "the state of
 * Realm extraction" - the import gate, the watermarks, the sync UI - must apply
 * this predicate.
 *
 * `analytics/pipeline.ts:loadAnalyticsDelta` deliberately does *not*: a
 * write-back row is a legitimate delta source.
 */
export const extractionImportOnly = ne(imports.kind, "writeback");
