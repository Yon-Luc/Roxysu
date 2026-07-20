/**
 * One-shot Roxysu → lazer collection sync (exits after one run).
 * Usage: tsx src/sync-collections-once.ts <payload.json>
 *
 * Payload shape: { collections: [...], skippedNoMd5: number }
 * Prints `RESULT <json>` to stdout on completion.
 */
import { readFileSync } from "node:fs";
import {
  closeDb,
  ensureDb,
} from "@roxysu/db/client.node";
import { defaultDbPath } from "./sync";
import { resolveRealmPathFromDb } from "./osu-paths";
import {
  runCollectionSync,
  type CollectionSyncPayload,
} from "./syncCollections";

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error("Usage: sync-collections-once.ts <payload.json>");
  process.exit(2);
}

const db = ensureDb(defaultDbPath());
let exitCode = 0;

try {
  const raw = readFileSync(payloadPath, "utf8");
  const payload = JSON.parse(raw) as CollectionSyncPayload;
  const realmPath = resolveRealmPathFromDb(db);
  const result = runCollectionSync(db, defaultDbPath(), realmPath, payload);
  console.log("RESULT", JSON.stringify(result));
  if (!result.ok) exitCode = 1;
} catch (err) {
  console.error(err);
  console.log(
    "RESULT",
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "other",
    }),
  );
  exitCode = 1;
} finally {
  try {
    closeDb(db);
  } catch {
    // already closed
  }
  process.exit(exitCode);
}
