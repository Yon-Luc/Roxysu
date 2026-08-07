import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Db } from "../db-runtime";
import { resolveBeatmapsDownloadDir } from "./downloadDir";
import { loadOwnedSetOnlineIds } from "./ownership";

const PENDING_FILENAME = ".roxysu-pending-downloads.json";

type PendingStore = {
  /** Beatmapset online IDs downloaded via Roxysu but not yet seen in the library. */
  setIds: number[];
  updatedAt: string;
};

function pendingStorePath(
  downloadDir: string = resolveBeatmapsDownloadDir(),
): string {
  return path.join(downloadDir, PENDING_FILENAME);
}

function readStore(filePath: string): PendingStore {
  try {
    if (!existsSync(filePath)) {
      return { setIds: [], updatedAt: new Date(0).toISOString() };
    }
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PendingStore>;
    const setIds = Array.isArray(raw.setIds)
      ? raw.setIds.filter(
          (id): id is number => Number.isSafeInteger(id) && id > 0,
        )
      : [];
    return {
      setIds: [...new Set(setIds)],
      updatedAt:
        typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return { setIds: [], updatedAt: new Date(0).toISOString() };
  }
}

function writeStore(filePath: string, setIds: Iterable<number>): PendingStore {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const store: PendingStore = {
    setIds: [...new Set(
      [...setIds].filter((id) => Number.isSafeInteger(id) && id > 0),
    )].sort((a, b) => a - b),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

/** Load pending download IDs from disk (no pruning). */
export function loadPendingDownloadIds(
  downloadDir: string = resolveBeatmapsDownloadDir(),
): Set<number> {
  return new Set(readStore(pendingStorePath(downloadDir)).setIds);
}

/** Record one or more set IDs as downloaded / awaiting lazer import + sync. */
export function recordPendingDownloads(
  setIds: Iterable<number>,
  downloadDir: string = resolveBeatmapsDownloadDir(),
): Set<number> {
  const filePath = pendingStorePath(downloadDir);
  const current = loadPendingDownloadIds(downloadDir);
  for (const id of setIds) {
    if (Number.isSafeInteger(id) && id > 0) current.add(id);
  }
  writeStore(filePath, current);
  return current;
}

/**
 * Drop pending IDs that are now in the local library (realm sync caught up).
 * Returns how many were pruned.
 */
export function prunePendingDownloadsAgainstOwned(
  ownedIds: ReadonlySet<number>,
  downloadDir: string = resolveBeatmapsDownloadDir(),
): { remaining: Set<number>; pruned: number } {
  const filePath = pendingStorePath(downloadDir);
  const current = loadPendingDownloadIds(downloadDir);
  let pruned = 0;
  for (const id of [...current]) {
    if (ownedIds.has(id)) {
      current.delete(id);
      pruned += 1;
    }
  }
  if (pruned > 0) writeStore(filePath, current);
  return { remaining: current, pruned };
}

/**
 * Owned ∪ pending (after pruning pending against owned). Use when hiding
 * maps the user already has or already downloaded through Roxysu.
 */
export async function loadIdsToHideFromDownloadSearch(
  db: Db,
  downloadDir: string = resolveBeatmapsDownloadDir(),
): Promise<{ owned: Set<number>; pending: Set<number>; hide: Set<number> }> {
  const owned = await loadOwnedSetOnlineIds(db);
  const { remaining: pending } = prunePendingDownloadsAgainstOwned(
    owned,
    downloadDir,
  );
  const hide = new Set<number>([...owned, ...pending]);
  return { owned, pending, hide };
}

export function pendingDownloadsStorePathForTests(
  downloadDir: string,
): string {
  return pendingStorePath(downloadDir);
}
