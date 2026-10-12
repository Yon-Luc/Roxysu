/**
 * One-shot score transfer → client.realm.
 * Usage: tsx src/write-score-transfer-once.ts <payload.json>
 * Prints `RESULT <json>` to stdout.
 */
import { readFileSync } from "node:fs";
import { closeDb, ensureDb } from "@roxysu/db/client.node";
import { resolveRealmPathFromDb } from "./osu-paths";
import { defaultDbPath } from "./sync";
import {
  runScoreTransferWrite,
  type ScoreTransferWritePayload,
} from "./writeScoreTransfer";

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error("Usage: write-score-transfer-once.ts <payload.json>");
  process.exit(2);
}

const db = ensureDb(defaultDbPath());
let exitCode = 0;

try {
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as ScoreTransferWritePayload;
  const realmPath = resolveRealmPathFromDb(db);
  const result = runScoreTransferWrite(db, defaultDbPath(), realmPath, payload);
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
