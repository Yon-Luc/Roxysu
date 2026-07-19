import { closeDb, ensureDb, eq, settings, type Db } from "@roxysu/db/client.node";
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
const PAUSE_POLL_MS = Number(process.env.REALM_PAUSE_POLL_MS ?? 2_000);
const FULL_EVERY_N = Number(process.env.REALM_FULL_EVERY_N ?? 10);
const FORCE_FULL = process.env.REALM_FULL_SYNC === "1";

/** Mirrors apps/server/src/routes/system.ts — web UI writes this via /api/system/sync-focus. */
const SYNC_UI_FOCUSED_KEY = "sync.ui_focused";

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

/** Explicit "0" means the web UI is unfocused; unset/"1" allows sync (headless-friendly). */
function isSyncPaused(db: Db): boolean {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_UI_FOCUSED_KEY))
    .limit(1)
    .get();
  return row?.value === "0";
}

async function waitUntilSyncAllowed(
  db: Db,
  lastSyncAt: number | null,
): Promise<boolean> {
  let pauseLogged = false;

  while (!shuttingDown) {
    if (isSyncPaused(db)) {
      if (!pauseLogged) {
        console.log(
          "sync paused (web UI unfocused) — waiting until focus returns",
        );
        pauseLogged = true;
      }
      await sleep(PAUSE_POLL_MS);
      continue;
    }

    if (pauseLogged) {
      console.log("sync resumed (web UI focused)");
      pauseLogged = false;
    }

    if (lastSyncAt != null) {
      const elapsed = Date.now() - lastSyncAt;
      if (elapsed < RESYNC_MS) {
        await sleep(RESYNC_MS - elapsed);
        // Re-check pause after waiting — user may have left again.
        continue;
      }
    }

    return true;
  }

  return false;
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
  let lastSyncAt: number | null = null;

  try {
    while (!shuttingDown) {
      const allowed = await waitUntilSyncAllowed(db, lastSyncAt);
      if (!allowed) break;

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
        lastSyncAt = Date.now();

        const del =
          result.kind === "full"
            ? ` del(scores=${result.scoresDeleted} maps=${result.beatmapsDeleted} sets=${result.beatmapSetsDeleted})`
            : "";
        console.log(
          `sync ${result.kind} — rulesets=${result.rulesetsUpserted} sets=${result.beatmapSetsUpserted} beatmaps=${result.beatmapsUpserted} scores=${result.scoresUpserted}${del} (realm v${result.realmSchemaVersion})`,
        );
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
