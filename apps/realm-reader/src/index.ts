import { closeDb, ensureDb, eq, settings, type Db } from "@roxysu/db/client.node";
import { defaultDbPath } from "@roxysu/db/path";
import {
  SYNC_PAUSE_WHEN_UNFOCUSED_KEY,
  SYNC_REALM_READER_PAUSED_KEY,
  SYNC_UI_FOCUSED_KEY,
} from "@roxysu/db/settings-keys";
import {
  RealmLockedError,
  SchemaVersionMismatchError,
  hasSuccessfulImport,
  runFullSync,
  runIncrementalSync,
  runReconcileSync,
} from "./sync";
import { resolveRealmPathFromDb } from "./osu-paths";

export { SYNC_REALM_READER_PAUSED_KEY };

const RETRY_MS = Number(process.env.REALM_RETRY_MS ?? 10_000);
const RESYNC_MS = Number(process.env.REALM_RESYNC_MS ?? 60_000);
const PAUSE_POLL_MS = Number(process.env.REALM_PAUSE_POLL_MS ?? 2_000);
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

/**
 * Pause only when the opt-in setting is on and the web UI reported unfocused.
 * Missing pause setting (default OFF) or unset/"1" focus allows sync (headless-friendly).
 */
function isSyncPaused(db: Db): boolean {
  const readerPaused = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY))
    .limit(1)
    .get();
  if (readerPaused?.value === "1") return true;

  const pauseEnabled = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
    .limit(1)
    .get();
  if (pauseEnabled?.value !== "1") return false;

  const focused = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_UI_FOCUSED_KEY))
    .limit(1)
    .get();
  return focused?.value === "0";
}

async function waitUntilSyncAllowed(
  db: Db,
  lastSyncAt: number | null,
): Promise<boolean> {
  let pauseLogged = false;
  let pauseReason: "reader" | "focus" | null = null;

  while (!shuttingDown) {
    if (isSyncPaused(db)) {
      const readerPaused = db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY))
        .limit(1)
        .get();
      const reason =
        readerPaused?.value === "1" ? ("reader" as const) : ("focus" as const);

      if (!pauseLogged || pauseReason !== reason) {
        if (reason === "reader") {
          console.log(
            "sync paused (collection write in progress) — waiting until resume",
          );
        } else {
          console.log(
            "sync paused (pause-when-unfocused + web UI unfocused) — waiting until focus returns",
          );
        }
        pauseLogged = true;
        pauseReason = reason;
      }
      await sleep(PAUSE_POLL_MS);
      continue;
    }

    if (pauseLogged) {
      console.log("sync resumed");
      pauseLogged = false;
      pauseReason = null;
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

  console.log("realm-reader starting");
  console.log("  DB_PATH   ", dbPath);
  console.log("  FULL_EVERY", FULL_EVERY_N);

  const db = ensureDb(dbPath);
  console.log("SQLite ready (migrations applied)");

  let lastRealmPath: string | null = null;
  let lockLogged = false;
  let cycle = 0;
  let lastSyncAt: number | null = null;

  try {
    while (!shuttingDown) {
      const allowed = await waitUntilSyncAllowed(db, lastSyncAt);
      if (!allowed) break;

      const realmPath = resolveRealmPathFromDb(db);
      if (realmPath !== lastRealmPath) {
        console.log("  REALM_PATH", realmPath);
        lastRealmPath = realmPath;
      }

      try {
        const needBootstrap = FORCE_FULL || !hasSuccessfulImport(db);
        const needReconcile = !needBootstrap && cycle % FULL_EVERY_N === 0;

        const result = needBootstrap
          ? runFullSync(db, realmPath)
          : needReconcile
            ? runReconcileSync(db, realmPath)
            : runIncrementalSync(db, realmPath);

        lockLogged = false;
        cycle += 1;
        lastSyncAt = Date.now();

        const del =
          result.scoresDeleted || result.beatmapsDeleted || result.beatmapSetsDeleted
            ? ` del(scores=${result.scoresDeleted} maps=${result.beatmapsDeleted} sets=${result.beatmapSetsDeleted})`
            : "";
        console.log(
          `sync ${result.kind} — rulesets=${result.rulesetsUpserted} sets=${result.beatmapSetsUpserted} beatmaps=${result.beatmapsUpserted} scores=${result.scoresUpserted} changed=${result.rowsChanged}${del} (realm v${result.realmSchemaVersion})`,
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
