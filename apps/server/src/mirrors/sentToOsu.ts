import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveBeatmapsDownloadDir } from "./downloadDir";

const SENT_FILENAME = ".roxysu-sent-to-osu.json";

type SentStore = {
  /** Absolute paths of .osz archives already handed to osu! for import. */
  paths: string[];
  updatedAt: string;
};

type SentCache = {
  downloadDir: string;
  paths: Set<string>;
};

let sentCache: SentCache | null = null;

function sentStorePath(
  downloadDir: string = resolveBeatmapsDownloadDir(),
): string {
  return path.join(downloadDir, SENT_FILENAME);
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function normalizeDir(downloadDir: string): string {
  return path.resolve(downloadDir);
}

function readStore(filePath: string): SentStore {
  try {
    if (!existsSync(filePath)) {
      return { paths: [], updatedAt: new Date(0).toISOString() };
    }
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SentStore>;
    const paths = Array.isArray(raw.paths)
      ? raw.paths
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .map(normalizePath)
      : [];
    return {
      paths: [...new Set(paths)],
      updatedAt:
        typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return { paths: [], updatedAt: new Date(0).toISOString() };
  }
}

function writeStore(filePath: string, paths: Iterable<string>): SentStore {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const store: SentStore = {
    paths: [...new Set([...paths].map(normalizePath))].sort((a, b) =>
      a.localeCompare(b),
    ),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

function cacheFor(downloadDir: string): Set<string> {
  const key = normalizeDir(downloadDir);
  if (sentCache && sentCache.downloadDir === key) {
    return sentCache.paths;
  }
  const paths = new Set(readStore(sentStorePath(downloadDir)).paths);
  sentCache = { downloadDir: key, paths };
  return paths;
}

function setCache(downloadDir: string, paths: Set<string>): void {
  sentCache = { downloadDir: normalizeDir(downloadDir), paths };
}

/** Drop the in-memory sent-to-osu cache (tests). */
export function clearSentToOsuCacheForTests(): void {
  sentCache = null;
}

/** Paths already sent to osu! (still on disk until lazer finishes importing). */
export function loadSentToOsuPaths(
  downloadDir: string = resolveBeatmapsDownloadDir(),
): Set<string> {
  return new Set(cacheFor(downloadDir));
}

export function isSentToOsu(
  filePath: string,
  downloadDir: string = resolveBeatmapsDownloadDir(),
): boolean {
  return cacheFor(downloadDir).has(normalizePath(filePath));
}

/** Mark archives as handed to osu! so Roxysu won't open them again. */
export function recordSentToOsu(
  filePaths: Iterable<string>,
  downloadDir: string = resolveBeatmapsDownloadDir(),
): Set<string> {
  const filePath = sentStorePath(downloadDir);
  const current = new Set(cacheFor(downloadDir));
  for (const p of filePaths) {
    if (typeof p === "string" && p.length > 0) current.add(normalizePath(p));
  }
  writeStore(filePath, current);
  setCache(downloadDir, current);
  return current;
}

/** Drop paths not yet sent to osu!. */
export function filterNotSentToOsu(
  filePaths: string[],
  downloadDir: string = resolveBeatmapsDownloadDir(),
): string[] {
  const sent = cacheFor(downloadDir);
  return filePaths.filter((p) => !sent.has(normalizePath(p)));
}

export function sentToOsuStorePathForTests(downloadDir: string): string {
  return sentStorePath(downloadDir);
}
