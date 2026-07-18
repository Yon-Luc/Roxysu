import { closeDb, ensureDb } from "@roxysu/db/client.node";
import {
  RealmLockedError,
  SchemaVersionMismatchError,
  defaultDbPath,
  defaultRealmPath,
  hasSuccessfulImport,
  runFullSync,
  runIncrementalSync,
} from "./sync";

const RETRY_MS = Number(process.env.REALM_RETRY_MS ?? 10_000);
const RESYNC_MS = Number(process.env.REALM_RESYNC_MS ?? 60_000);
const FULL_EVERY_N = Number(process.env.REALM_FULL_EVERY_N ?? 10);
const FORCE_FULL = process.env.REALM_FULL_SYNC === "1";

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
  console.log("  FULL_EVERY", FULL_EVERY_N);

  const db = ensureDb(dbPath);
  console.log("SQLite ready (migrations applied)");

  let lockLogged = false;
  let cycle = 0;

  try {
    while (!shuttingDown) {
      try {
        const needFull =
          FORCE_FULL ||
          !hasSuccessfulImport(db) ||
          cycle % FULL_EVERY_N === 0;

        const result = needFull
          ? runFullSync(db, realmPath)
          : runIncrementalSync(db, realmPath);

        lockLogged = false;
        cycle += 1;

        const del =
          result.kind === "full"
            ? ` del(scores=${result.scoresDeleted} maps=${result.beatmapsDeleted} sets=${result.beatmapSetsDeleted})`
            : "";
        console.log(
          `sync ${result.kind} — rulesets=${result.rulesetsUpserted} sets=${result.beatmapSetsUpserted} beatmaps=${result.beatmapsUpserted} scores=${result.scoresUpserted}${del} (realm v${result.realmSchemaVersion})`,
        );
        if (!shuttingDown) await sleep(RESYNC_MS);
      } catch (err) {
        if (err instanceof RealmLockedError) {
          if (!lockLogged) {
            console.warn(
              `realm locked (osu!lazer open?) — retrying every ${RETRY_MS}ms`,
            );
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
