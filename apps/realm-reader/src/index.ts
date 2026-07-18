import { closeDb, ensureDb } from "@roxysu/db/client.node";
import {
  RealmLockedError,
  SchemaVersionMismatchError,
  defaultDbPath,
  defaultRealmPath,
  recordLockedImport,
  runFullSync,
} from "./sync";

const RETRY_MS = Number(process.env.REALM_RETRY_MS ?? 10_000);
const RESYNC_MS = Number(process.env.REALM_RESYNC_MS ?? 60_000);

let shuttingDown = false;
let wakeSleep: (() => void) | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeSleep = null;
      resolve();
    }, ms);
    wakeSleep = () => {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    };
  });
}

function requestShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nshutting down…");
  wakeSleep?.();
}

async function main() {
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);

  const dbPath = defaultDbPath();
  const realmPath = defaultRealmPath();

  console.log("realm-reader starting");
  console.log("  DB_PATH   ", dbPath);
  console.log("  REALM_PATH", realmPath);

  const db = ensureDb(dbPath);
  console.log("SQLite ready (migrations applied)");

  let lockLogged = false;

  try {
    while (!shuttingDown) {
      try {
        const result = runFullSync(db, realmPath);
        lockLogged = false;
        console.log(
          `sync ok — rulesets=${result.rulesetsUpserted} sets=${result.beatmapSetsUpserted} beatmaps=${result.beatmapsUpserted} scores=${result.scoresUpserted} (realm v${result.realmSchemaVersion})`,
        );
        if (!shuttingDown) await sleep(RESYNC_MS);
      } catch (err) {
        if (err instanceof RealmLockedError) {
          if (!lockLogged) {
            console.warn(
              `realm locked (osu!lazer open?) — retrying every ${RETRY_MS}ms`,
            );
            try {
              recordLockedImport(db, err.message);
            } catch {
              // ignore ledger write failures during lock
            }
            lockLogged = true;
          }
          if (!shuttingDown) await sleep(RETRY_MS);
          continue;
        }

        if (err instanceof SchemaVersionMismatchError) {
          console.error(err.message);
          process.exit(1);
        }

        console.error("sync failed:", err);
        if (!shuttingDown) await sleep(RETRY_MS);
      }
    }
  } finally {
    try {
      closeDb(db);
    } catch {
      // already closed
    }
  }

  // Realm's native addon keeps the event loop alive after close().
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
