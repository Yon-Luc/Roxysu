import { eq } from "drizzle-orm";
import { settings } from "./schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "./settings-keys";
import type { Db } from "./types";

/**
 * Collection sync sets `sync.realm_reader_paused=1` while writing client.realm
 * and clears it in a finally. A crash / hard kill can leave it stuck, which
 * blocks realm-reader forever. Safe to clear on process start: no collection
 * write can still be in progress in *this* process.
 *
 * @returns true when a stuck pause was cleared
 */
export function clearStuckRealmReaderPause(db: Db): boolean {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_REALM_READER_PAUSED_KEY))
    .limit(1)
    .get();

  if (row?.value !== "1") return false;

  db.insert(settings)
    .values({ key: SYNC_REALM_READER_PAUSED_KEY, value: "0" })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: "0" },
    })
    .run();

  return true;
}
