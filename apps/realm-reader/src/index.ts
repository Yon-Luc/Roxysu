import { ensureDb } from "@roxysu/db/client.node";
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dbPath = defaultDbPath();
  const realmPath = defaultRealmPath();

  console.log("realm-reader starting");
  console.log("  DB_PATH   ", dbPath);
  console.log("  REALM_PATH", realmPath);

  const db = ensureDb(dbPath);
  console.log("SQLite ready (migrations applied)");

  let lockLogged = false;

  for (;;) {
    try {
      const result = runFullSync(db, realmPath);
      lockLogged = false;
      console.log(
        `sync ok — rulesets=${result.rulesetsUpserted} sets=${result.beatmapSetsUpserted} beatmaps=${result.beatmapsUpserted} scores=${result.scoresUpserted} (realm v${result.realmSchemaVersion})`,
      );
      await sleep(RESYNC_MS);
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
        await sleep(RETRY_MS);
        continue;
      }

      if (err instanceof SchemaVersionMismatchError) {
        console.error(err.message);
        process.exit(1);
      }

      console.error("sync failed:", err);
      await sleep(RETRY_MS);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
