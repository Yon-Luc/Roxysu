import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import type { Db } from "@roxysu/db/types";
import {
  beatmaps,
  beatmapSets,
  collections,
  hubAddedCollections,
  settings,
} from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import { defaultDbPath } from "@roxysu/db/path";
import type {
  CollectionSyncPayload,
  CollectionSyncResult,
  LazerCollectionSyncError,
  LazerCollectionSyncSuccess,
} from "@roxysu/collection-sync";
import { hubSyncId } from "@roxysu/collection-sync";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  listCollectionMd5Hashes,
  parseQuery,
  QueryParseError,
} from "../query-language";
import {
  getCachedOsuDataOverride,
  resolveOsuDataPath,
  resolveRealmPath,
} from "./osu-paths";

export { SYNC_REALM_READER_PAUSED_KEY };
export type { LazerCollectionSyncSuccess, LazerCollectionSyncError };

const PAUSE_SETTLE_MS = 2_000;

let writeBackInFlight: Promise<
  | { ok: true; result: LazerCollectionSyncSuccess }
  | { ok: false; error: LazerCollectionSyncError }
> | null = null;

type Md5List = { hashes: string[]; skippedNoMd5: number };
type Md5CacheEntry = { value: Md5List; at: number };

const MD5_CACHE_MAX = 32;
const MD5_CACHE_TTL_MS = 10 * 60 * 1000;
const md5ListCache = new Map<string, Md5CacheEntry>();

export function invalidateCollectionMd5Cache(): void {
  md5ListCache.clear();
}

function md5CacheGet(key: string): Md5List | undefined {
  const entry = md5ListCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > MD5_CACHE_TTL_MS) {
    md5ListCache.delete(key);
    return undefined;
  }
  md5ListCache.delete(key);
  md5ListCache.set(key, entry);
  return entry.value;
}

function md5CacheSet(key: string, value: Md5List): void {
  if (md5ListCache.has(key)) md5ListCache.delete(key);
  md5ListCache.set(key, { value, at: Date.now() });
  while (md5ListCache.size > MD5_CACHE_MAX) {
    const oldest = md5ListCache.keys().next().value;
    if (oldest == null) break;
    md5ListCache.delete(oldest);
  }
}

function hubMd5CacheKey(ids: number[]): string {
  const digest = createHash("sha1")
    .update(ids.slice().sort((a, b) => a - b).join(","))
    .digest("hex");
  return `hub:${digest}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBunRuntime(): boolean {
  return typeof (process.versions as { bun?: string }).bun === "string";
}

function realmReaderDir(): string {
  const fromEnv = process.env.ROXYSU_REALM_READER_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../realm-reader");
}

function realmSyncModulePath(): string {
  const dir = realmReaderDir();
  const packaged = path.join(dir, "syncCollections.js");
  if (process.env.ROXYSU_REALM_READER_DIR?.trim()) {
    return packaged;
  }
  return path.join(dir, "src", "syncCollections.ts");
}

/** Node/desktop: call realm-reader in-process (no bunx/tsx). */
async function runSyncInProcess(
  db: Db,
  payload: CollectionSyncPayload,
): Promise<CollectionSyncResult> {
  const modUrl = pathToFileURL(realmSyncModulePath()).href;
  const { runCollectionSync } = await import(modUrl);
  const dbPath = process.env.DB_PATH?.trim() || defaultDbPath();
  return runCollectionSync(db, dbPath, resolveRealmPathForSync(), payload);
}

function resolveRealmPathForSync(): string {
  if (process.env.REALM_PATH?.trim()) return process.env.REALM_PATH.trim();
  const dataPath = resolveOsuDataPath(getCachedOsuDataOverride()).resolved;
  return resolveRealmPath(dataPath);
}

/** Bun monorepo: Realm cannot load in-process — spawn the Node CLI. */
function runSyncCli(
  payloadPath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "src/sync-collections-once.ts", payloadPath],
      {
        cwd: realmReaderDir(),
        env: {
          ...process.env,
          DB_PATH: process.env.DB_PATH ?? defaultDbPath(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function parseCliResult(stdout: string): CollectionSyncResult {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("RESULT "));
  if (!line) {
    return {
      ok: false,
      error: "Collection sync produced no result",
      code: "other",
    };
  }

  return JSON.parse(line.slice("RESULT ".length)) as CollectionSyncResult;
}

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });
}

/** Distinct MD5 hashes for beatmaps in the given beatmapset online IDs. */
export async function md5HashesForSetOnlineIds(
  db: Db,
  setOnlineIds: number[],
): Promise<{ hashes: string[]; skippedNoMd5: number }> {
  const unique = [
    ...new Set(setOnlineIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
  ];
  if (unique.length === 0) return { hashes: [], skippedNoMd5: 0 };
  const cacheKey = hubMd5CacheKey(unique);
  const cached = md5CacheGet(cacheKey);
  if (cached) return cached;

  const rows = await db
    .selectDistinct({ md5: beatmaps.md5Hash })
    .from(beatmaps)
    .innerJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(
      and(
        inArray(beatmapSets.onlineId, unique),
        eq(beatmapSets.deletePending, false),
        isNotNull(beatmaps.md5Hash),
        ne(beatmaps.md5Hash, ""),
        sql`trim(${beatmaps.md5Hash}) != ''`,
      ),
    );

  const hashes = rows
    .map((r) => r.md5)
    .filter((h): h is string => typeof h === "string" && h.length > 0);

  // Approximate: sets with no resolvable hash count as skipped.
  const setsWithHash = await db
    .selectDistinct({ onlineId: beatmapSets.onlineId })
    .from(beatmapSets)
    .innerJoin(beatmaps, eq(beatmaps.setId, beatmapSets.id))
    .where(
      and(
        inArray(beatmapSets.onlineId, unique),
        eq(beatmapSets.deletePending, false),
        isNotNull(beatmaps.md5Hash),
        ne(beatmaps.md5Hash, ""),
      ),
    );
  const resolved = new Set(setsWithHash.map((r) => r.onlineId));
  const skippedNoMd5 = unique.filter((id) => !resolved.has(id)).length;

  const result = { hashes, skippedNoMd5 };
  md5CacheSet(cacheKey, result);
  return result;
}

function parseBeatmapsetIdsJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is number =>
            typeof id === "number" && Number.isSafeInteger(id) && id > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export async function syncCollectionsToLazer(
  db: Db,
): Promise<
  | { ok: true; result: LazerCollectionSyncSuccess }
  | { ok: false; error: LazerCollectionSyncError }
> {
  if (writeBackInFlight) {
    return {
      ok: false,
      error: {
        error: "Collection write-back already running",
        code: "in_flight",
      },
    };
  }

  writeBackInFlight = runCollectionWriteBack(db);
  try {
    return await writeBackInFlight;
  } finally {
    writeBackInFlight = null;
  }
}

async function runCollectionWriteBack(
  db: Db,
): Promise<
  | { ok: true; result: LazerCollectionSyncSuccess }
  | { ok: false; error: LazerCollectionSyncError }
> {
  const rows = await db.select().from(collections);

  const payloadCollections: CollectionSyncPayload["collections"] = [];
  let skippedNoMd5 = 0;

  for (const col of rows) {
    try {
      parseQuery(col.query);
    } catch (err) {
      if (err instanceof QueryParseError) {
        return {
          ok: false,
          error: {
            error: `Collection "${col.name}" has invalid query: ${err.message}`,
            code: "other",
          },
        };
      }
      throw err;
    }

    const cacheKey = `smart:${col.query}`;
    const cached = md5CacheGet(cacheKey);
    const { hashes, skippedNoMd5: skipped } = cached
      ? cached
      : (() => {
          const computed = listCollectionMd5Hashes(db, col.query);
          md5CacheSet(cacheKey, computed);
          return computed;
        })();
    skippedNoMd5 += skipped;
    payloadCollections.push({
      id: col.id,
      name: col.name,
      lazerCollectionId: col.lazerCollectionId ?? null,
      md5Hashes: hashes,
    });
  }

  const hubRows = await db.select().from(hubAddedCollections);
  for (const col of hubRows) {
    const setIds = parseBeatmapsetIdsJson(col.beatmapsetIdsJson);
    const { hashes, skippedNoMd5: skipped } = await md5HashesForSetOnlineIds(
      db,
      setIds,
    );
    skippedNoMd5 += skipped;
    payloadCollections.push({
      id: hubSyncId(col.hubCollectionId),
      name: col.name,
      lazerCollectionId: col.lazerCollectionId ?? null,
      md5Hashes: hashes,
      hubCollectionId: col.hubCollectionId,
    });
  }

  const payload: CollectionSyncPayload = {
    collections: payloadCollections,
    skippedNoMd5,
  };

  await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "1");
  await sleep(PAUSE_SETTLE_MS);

  try {
    let syncResult: CollectionSyncResult;

    if (!isBunRuntime()) {
      syncResult = await runSyncInProcess(db, payload);
    } else {
      const tempDir = mkdtempSync(path.join(tmpdir(), "roxysu-collection-sync-"));
      const payloadPath = path.join(tempDir, "payload.json");
      try {
        writeFileSync(payloadPath, JSON.stringify(payload));
        const { stdout, stderr, exitCode } = await runSyncCli(payloadPath);
        if (exitCode !== 0 && !stdout.includes("RESULT ")) {
          return {
            ok: false,
            error: {
              error: stderr.trim() || stdout.trim() || "Collection sync failed",
              code: "other",
            },
          };
        }
        syncResult = parseCliResult(stdout);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }

    if (!syncResult.ok) {
      return {
        ok: false,
        error: {
          error: syncResult.error,
          code: syncResult.code ?? "other",
        },
      };
    }

    const { ok: _ok, ...result } = syncResult;
    return { ok: true, result };
  } finally {
    await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "0");
  }
}
