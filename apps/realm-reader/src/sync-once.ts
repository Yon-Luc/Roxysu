/**
 * One-shot full sync for manual verification (exits after one run).
 * Usage: bunx tsx src/sync-once.ts
 */
import {
  ensureDb,
  rulesets,
  beatmapSets,
  beatmaps,
  scores,
  imports,
  sql,
} from "@roxysu/db/client.node";
import { defaultDbPath, defaultRealmPath, runFullSync } from "./sync";

const db = ensureDb(defaultDbPath());
const result = runFullSync(db, defaultRealmPath());
console.log("RESULT", result);

const counts = {
  rulesets: db.select({ c: sql<number>`count(*)` }).from(rulesets).get()?.c,
  beatmap_sets: db
    .select({ c: sql<number>`count(*)` })
    .from(beatmapSets)
    .get()?.c,
  beatmaps: db.select({ c: sql<number>`count(*)` }).from(beatmaps).get()?.c,
  scores: db.select({ c: sql<number>`count(*)` }).from(scores).get()?.c,
  last_import: db
    .select()
    .from(imports)
    .orderBy(sql`${imports.id} desc`)
    .limit(1)
    .get(),
};
console.log("COUNTS", counts);
