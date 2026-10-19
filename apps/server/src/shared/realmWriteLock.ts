import { settings } from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";

/**
 * One exclusive lock for every writer of `client.realm` (collection write-back, online score pull
 * commit, score transfer commit), plus one reference-counted extraction pause.
 *
 * The pause flag is a single settings row, so it must be "1" from the first holder's acquire until
 * the last holder's release. Writers are mutually exclusive, so normally at most one holds it; the
 * count keeps the flag correct if any caller pauses extraction around the lock.
 */

export type RealmWriteOwner =
  | "collection_write_back"
  | "online_score_commit"
  | "score_transfer_commit";

const OWNER_LABEL: Record<RealmWriteOwner, string> = {
  collection_write_back: "Collection write-back",
  online_score_commit: "Online score write",
  score_transfer_commit: "Score transfer write",
};

export const DEFAULT_PAUSE_SETTLE_MS = 2_000;

let holder: RealmWriteOwner | null = null;
let pauseHolders = 0;
let pauseChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setPauseFlag(db: Db, value: "0" | "1"): Promise<void> {
  await db
    .insert(settings)
    .values({ key: SYNC_REALM_READER_PAUSED_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Serialise pause transitions so a "0" write can never overtake a later "1" write. */
function enqueuePauseTransition<T>(fn: () => Promise<T>): Promise<T> {
  const run = pauseChain.then(fn, fn);
  pauseChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The writer currently holding the Realm write lock, or null. */
export function currentRealmWriteOwner(): RealmWriteOwner | null {
  return holder;
}

export function realmWriteBusyMessage(owner: RealmWriteOwner | null = holder): string {
  return owner
    ? `${OWNER_LABEL[owner]} already running`
    : "Another Realm write is already running";
}

/**
 * Pause Realm extraction. The first holder sets the flag to "1"; the returned release function
 * (idempotent) sets it back to "0" only when the last holder releases.
 */
export async function acquireExtractionPause(
  db: Db,
): Promise<() => Promise<void>> {
  await enqueuePauseTransition(async () => {
    if (pauseHolders === 0) await setPauseFlag(db, "1");
    pauseHolders += 1;
  });
  let released = false;
  return () => {
    if (released) return Promise.resolve();
    released = true;
    return enqueuePauseTransition(async () => {
      pauseHolders -= 1;
      if (pauseHolders === 0) await setPauseFlag(db, "0");
    });
  };
}

export type RealmWriteLease = {
  readonly owner: RealmWriteOwner;
  /** Pause extraction and wait for an in-progress extraction pass to notice. */
  pauseExtraction(settleMs?: number): Promise<void>;
  /** Release the extraction pause (if held) and then the lock. Safe to call more than once. */
  release(): Promise<void>;
};

/**
 * Take the exclusive Realm write lock. Returns null when another Realm write holds it; the caller
 * should answer with its `in_flight` result (HTTP 409 on the existing routes).
 */
export function tryAcquireRealmWriteLock(
  db: Db,
  owner: RealmWriteOwner,
): RealmWriteLease | null {
  if (holder) return null;
  holder = owner;

  let releasePause: (() => Promise<void>) | null = null;
  let released = false;

  return {
    owner,
    async pauseExtraction(settleMs = DEFAULT_PAUSE_SETTLE_MS) {
      if (released) throw new Error("Realm write lock already released");
      if (!releasePause) releasePause = await acquireExtractionPause(db);
      if (settleMs > 0) await sleep(settleMs);
    },
    async release() {
      if (released) return;
      released = true;
      try {
        if (releasePause) await releasePause();
      } finally {
        if (holder === owner) holder = null;
      }
    },
  };
}

/** Test helper: forget all lock and pause state. */
export function resetRealmWriteLockForTests(): void {
  holder = null;
  pauseHolders = 0;
  pauseChain = Promise.resolve();
}
