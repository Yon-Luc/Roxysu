import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, asc, eq, gt, gte, inArray, lte, type SQL } from "drizzle-orm";
import { beatmaps, scores } from "@roxysu/db/schema";
import { defaultDbPath } from "@roxysu/db/path";
import type { Db } from "@roxysu/db/types";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";
import {
  FINGERPRINT_MS,
  buildTransferIndex,
  classifyTransferScore,
  type TransferBeatmap,
  type TransferFinger,
} from "../../../realm-reader/src/scoreTransferMatch";
import {
  SCORE_TRANSFER_FORMAT,
  SCORE_TRANSFER_VERSION,
  parseScoreTransferFile,
  type ScoreTransferFile,
  type ScoreTransferRow,
} from "./format";
import {
  realmWriteBusyMessage,
  tryAcquireRealmWriteLock,
  type RealmWriteLease,
} from "../shared/realmWriteLock";

export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const UPLOAD_TTL_MS = 30 * 60 * 1000;
const WRITE_CLI_TIMEOUT_MS = 45_000;

export function scoreTransferTooLarge(byteLength: number): boolean {
  return byteLength > MAX_UPLOAD_BYTES;
}

type UploadStore = { dir?: string };

function uploadRoot(dir?: string): string {
  const root =
    dir?.trim() ||
    process.env.ROXYSU_SCORE_TRANSFER_DIR?.trim() ||
    path.join(tmpdir(), "roxysu-score-transfer");
  mkdirSync(root, { recursive: true });
  return root;
}

function safeUploadId(id: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export function scoreTransferUploadFile(uploadId: string, dir?: string): string | null {
  const id = safeUploadId(uploadId);
  if (!id) return null;
  return path.join(uploadRoot(dir), id, "upload.json");
}

export function sweepExpiredScoreTransferUploads(now = Date.now(), dir?: string): void {
  let names: string[] = [];
  try {
    names = readdirSync(uploadRoot(dir));
  } catch {
    return;
  }
  for (const name of names) {
    if (!safeUploadId(name)) continue;
    const file = path.join(uploadRoot(dir), name, "upload.json");
    try {
      if (now - statSync(file).mtimeMs > UPLOAD_TTL_MS) {
        rmSync(path.join(uploadRoot(dir), name), { recursive: true, force: true });
      }
    } catch {
      // already gone
    }
  }
}

export function discardScoreTransferUploads(dir?: string): void {
  rmSync(uploadRoot(dir), { recursive: true, force: true });
}

export type TransferPreview = {
  found: number;
  already: number;
  add: number;
  currentVersion: number;
  skipped: number;
  invalid: number;
};

export type TransferWriteResult =
  | { ok: true; added: number; skipped: number; backupPath: string; scoreIds: string[] }
  | { ok: false; error: string; code: "locked" | "schema_mismatch" | "in_flight" | "other" };

function isBunRuntime(): boolean {
  return typeof (process.versions as { bun?: string }).bun === "string";
}

function realmReaderDir(): string {
  const fromEnv = process.env.ROXYSU_REALM_READER_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../realm-reader");
}

function toMs(value: Date | number | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

async function loadIndex(db: Db, fileScores: ScoreTransferRow[]) {
  const onlineIds = new Set<number>();
  const legacyIds = new Set<number>();
  /** Per-ruleset play time span of the transfer, widened by the fingerprint window. */
  const windows = new Map<string, { min: number; max: number }>();
  const beatmapOnlineIds = new Set<number>();
  const beatmapMd5s = new Set<string>();
  const beatmapHashes = new Set<string>();

  const addIdentity = (set: Set<string>, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    // The matcher compares normalized values; stored hashes are lowercase hex.
    set.add(trimmed.toLowerCase());
  };

  for (const row of fileScores) {
    if (row.onlineId > 0) onlineIds.add(row.onlineId);
    if (row.legacyOnlineId > 0) legacyIds.add(row.legacyOnlineId);
    if (row.beatmapOnlineId > 0) beatmapOnlineIds.add(row.beatmapOnlineId);
    addIdentity(beatmapMd5s, row.beatmapMd5);
    addIdentity(beatmapHashes, row.beatmapHash);
    if (!row.ruleset) continue;
    const window = windows.get(row.ruleset);
    if (window) {
      window.min = Math.min(window.min, row.playedAt);
      window.max = Math.max(window.max, row.playedAt);
    } else {
      windows.set(row.ruleset, { min: row.playedAt, max: row.playedAt });
    }
  }

  if (windows.size === 0 && onlineIds.size === 0 && legacyIds.size === 0) {
    return buildTransferIndex([], []);
  }

  const scoreRows: Awaited<ReturnType<typeof selectIndexScores>> = [];
  const seenScoreIds = new Set<string>();
  const collectScores = async (where: SQL | undefined) => {
    const part = await selectIndexScores(db, where);
    for (const row of part) {
      if (seenScoreIds.has(row.id)) continue;
      seenScoreIds.add(row.id);
      scoreRows.push(row);
    }
  };

  // Id hits (`already`) — only the ids this transfer actually carries.
  for (const chunk of chunked([...onlineIds], INDEX_QUERY_CHUNK)) {
    await collectScores(inArray(scores.onlineId, chunk));
  }
  for (const chunk of chunked([...legacyIds], INDEX_QUERY_CHUNK)) {
    await collectScores(inArray(scores.legacyOnlineId, chunk));
  }
  // Fingerprint hits: same ruleset and within the ±window of an uploaded play.
  // Any `sameScore` match is necessarily inside this range, so nothing is missed.
  for (const [ruleset, window] of windows) {
    await collectScores(
      and(
        eq(scores.rulesetShortName, ruleset),
        gte(scores.playedAt, new Date(window.min - FINGERPRINT_MS)),
        lte(scores.playedAt, new Date(window.max + FINGERPRINT_MS)),
      ),
    );
  }

  // Only beatmaps referenced by the transfer are needed to classify it. A
  // transfer that carries the whole library would need thousands of `IN` lists,
  // so fall back to one bounded scan of the (much smaller) beatmap table.
  const mapRows: Awaited<ReturnType<typeof selectIndexBeatmaps>> = [];
  const seenMapIds = new Set<string>();
  const collectMaps = async (where: SQL | undefined) => {
    const part = await selectIndexBeatmaps(db, where);
    for (const row of part) {
      if (seenMapIds.has(row.id)) continue;
      seenMapIds.add(row.id);
      mapRows.push(row);
    }
  };
  const mapIdentities =
    beatmapOnlineIds.size + beatmapMd5s.size + beatmapHashes.size;
  if (mapIdentities > MAP_TARGET_LIMIT) {
    await collectMaps(undefined);
  } else {
    for (const chunk of chunked([...beatmapOnlineIds], INDEX_QUERY_CHUNK)) {
      await collectMaps(inArray(beatmaps.onlineId, chunk));
    }
    for (const chunk of chunked([...beatmapMd5s], INDEX_QUERY_CHUNK)) {
      await collectMaps(inArray(beatmaps.md5Hash, chunk));
    }
    for (const chunk of chunked([...beatmapHashes], INDEX_QUERY_CHUNK)) {
      await collectMaps(inArray(beatmaps.hash, chunk));
    }
  }

  const fingers: TransferFinger[] = scoreRows.map((row) => ({
    onlineId: row.onlineId,
    legacyOnlineId: row.legacyOnlineId,
    beatmapOnlineId: row.beatmapOnlineId ?? 0,
    beatmapMd5: row.beatmapMd5,
    beatmapHash: row.beatmapHash || row.beatmapFileHash,
    ruleset: row.ruleset ?? "",
    playedAtMs: toMs(row.playedAt),
    totalScore: row.totalScore,
    legacyTotalScore: row.legacyTotalScore,
  }));
  const maps: TransferBeatmap[] = mapRows.flatMap((row) =>
    row.hash ? [{ onlineId: row.onlineId, md5Hash: row.md5Hash, hash: row.hash }] : [],
  );
  return buildTransferIndex(fingers, maps);
}

/** Rows per `IN (…)` list; stays well under SQLite's bind-variable limit. */
const INDEX_QUERY_CHUNK = 500;
/** Above this many beatmap identities, one full beatmap scan beats many lists. */
const MAP_TARGET_LIMIT = 2_000;

function chunked<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function selectIndexScores(db: Db, where: SQL | undefined) {
  return db
    .select({
      id: scores.id,
      onlineId: scores.onlineId,
      legacyOnlineId: scores.legacyOnlineId,
      beatmapHash: scores.beatmapHash,
      ruleset: scores.rulesetShortName,
      playedAt: scores.playedAt,
      totalScore: scores.totalScore,
      legacyTotalScore: scores.legacyTotalScore,
      beatmapOnlineId: beatmaps.onlineId,
      beatmapMd5: beatmaps.md5Hash,
      beatmapFileHash: beatmaps.hash,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(where);
}

function selectIndexBeatmaps(db: Db, where: SQL | undefined) {
  return db
    .select({
      id: beatmaps.id,
      onlineId: beatmaps.onlineId,
      md5Hash: beatmaps.md5Hash,
      hash: beatmaps.hash,
    })
    .from(beatmaps)
    .where(where);
}

function fingerOf(row: ScoreTransferRow): TransferFinger {
  return {
    onlineId: row.onlineId,
    legacyOnlineId: row.legacyOnlineId,
    beatmapOnlineId: row.beatmapOnlineId,
    beatmapMd5: row.beatmapMd5,
    beatmapHash: row.beatmapHash,
    ruleset: row.ruleset,
    playedAtMs: row.playedAt,
    totalScore: row.totalScore,
    legacyTotalScore: row.legacyTotalScore,
  };
}

function summarize(file: ScoreTransferFile, invalid: number, index: ReturnType<typeof buildTransferIndex>): TransferPreview {
  let already = 0;
  let add = 0;
  let currentVersion = 0;
  let skipped = 0;
  for (const score of file.scores) {
    const kind = classifyTransferScore(fingerOf(score), index);
    if (kind === "already") already += 1;
    else if (kind === "add") add += 1;
    else if (kind === "add-current-version") currentVersion += 1;
    else skipped += 1;
  }
  return {
    found: file.scores.length,
    already,
    add,
    currentVersion,
    skipped,
    invalid,
  };
}

/** Rows read from the local mirror per keyset page while exporting. */
export const EXPORT_CHUNK_ROWS = 1_000;

async function loadExportPage(
  db: Db,
  where: SQL | undefined,
  afterId: string | null,
  limit: number,
): Promise<{ lastId: string | null; count: number; rows: ScoreTransferRow[] }> {
  const pageWhere = afterId == null ? where : and(where, gt(scores.id, afterId));
  const rows = await db
    .select({
      id: scores.id,
      onlineId: scores.onlineId,
      legacyOnlineId: scores.legacyOnlineId,
      beatmapHash: scores.beatmapHash,
      ruleset: scores.rulesetShortName,
      clientVersion: scores.clientVersion,
      totalScore: scores.totalScore,
      totalScoreWithoutMods: scores.totalScoreWithoutMods,
      legacyTotalScore: scores.legacyTotalScore,
      maxCombo: scores.maxCombo,
      combo: scores.combo,
      accuracy: scores.accuracy,
      pp: scores.pp,
      rank: scores.rank,
      mods: scores.mods,
      statistics: scores.statistics,
      maximumStatistics: scores.maximumStatistics,
      playedAt: scores.playedAt,
      userOnlineId: scores.userOnlineId,
      username: scores.userUsername,
      isLegacy: scores.isLegacyScore,
      beatmapOnlineId: beatmaps.onlineId,
      beatmapMd5: beatmaps.md5Hash,
      beatmapFileHash: beatmaps.hash,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(pageWhere)
    .orderBy(asc(scores.id))
    .limit(limit);
  return {
    lastId: rows.length > 0 ? rows[rows.length - 1]!.id : null,
    count: rows.length,
    rows: rows.flatMap((row) => {
      if (!row.ruleset) return [];
      return [
        {
          onlineId: row.onlineId,
          legacyOnlineId: row.legacyOnlineId,
          beatmapOnlineId: row.beatmapOnlineId ?? 0,
          beatmapMd5: row.beatmapMd5,
          beatmapHash: row.beatmapHash || row.beatmapFileHash,
          ruleset: row.ruleset,
          clientVersion: row.clientVersion,
          totalScore: row.totalScore,
          totalScoreWithoutMods: row.totalScoreWithoutMods,
          legacyTotalScore: row.legacyTotalScore,
          maxCombo: row.maxCombo,
          combo: row.combo,
          accuracy: row.accuracy,
          pp: row.pp,
          rank: row.rank,
          mods: row.mods,
          statistics: row.statistics,
          maximumStatistics: row.maximumStatistics,
          playedAt: toMs(row.playedAt),
          userOnlineId: row.userOnlineId,
          username: row.username,
          isLegacy: row.isLegacy,
        },
      ];
    }),
  };
}

/**
 * Export as a lazily produced sequence of JSON text pieces. Concatenated, they
 * are byte-identical to `JSON.stringify(file)` of a `ScoreTransferFile`
 * (same key order, no whitespace), so the import path is unchanged. Rows are
 * read in keyset pages of `chunkRows` (ordered by score id) and each page is
 * encoded and yielded before the next is read, so memory is bounded by one
 * page instead of the whole library.
 */
export async function* exportScoreTransferChunks(
  db: Db,
  opts: { chunkRows?: number; exportedAt?: string } = {},
): AsyncGenerator<string, void, void> {
  const chunkRows = Math.max(1, opts.chunkRows ?? EXPORT_CHUNK_ROWS);
  const usernames = await resolveScoresUsernames(db);
  const userCond = scoresUsernameCondition(usernames);
  const where = userCond
    ? and(eq(scores.deletePending, false), userCond)
    : eq(scores.deletePending, false);

  yield `{"format":${JSON.stringify(SCORE_TRANSFER_FORMAT)},"version":${SCORE_TRANSFER_VERSION},"exportedAt":${JSON.stringify(
    opts.exportedAt ?? new Date().toISOString(),
  )},"scores":[`;
  let afterId: string | null = null;
  let first = true;
  for (;;) {
    const page = await loadExportPage(db, where, afterId, chunkRows);
    if (page.count === 0) break;
    afterId = page.lastId;
    if (page.rows.length > 0) {
      const body = page.rows.map((row) => JSON.stringify(row)).join(",");
      yield first ? body : `,${body}`;
      first = false;
    }
    if (page.count < chunkRows) break;
  }
  yield "]}";
}

/** Same document as `exportScoreTransferChunks`, as a pull-based byte stream. */
export function exportScoreTransferStream(
  db: Db,
  opts: { chunkRows?: number; exportedAt?: string } = {},
): ReadableStream<Uint8Array> {
  const chunks = exportScoreTransferChunks(db, opts);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return();
    },
  });
}

export async function previewScoreTransfer(
  db: Db,
  bytes: Uint8Array,
  store: UploadStore = {},
): Promise<(TransferPreview & { uploadId: string }) | { error: string }> {
  if (bytes.byteLength === 0) return { error: "Missing score file" };
  if (scoreTransferTooLarge(bytes.byteLength)) return { error: "Score file is too large" };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { error: "This file is not a Roxysu score transfer." };
  }
  const parsed = parseScoreTransferFile(raw);
  if ("error" in parsed) return parsed;
  sweepExpiredScoreTransferUploads(Date.now(), store.dir);
  const uploadId = randomUUID();
  const file = scoreTransferUploadFile(uploadId, store.dir);
  if (!file) return { error: "Could not store the score file" };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const index = await loadIndex(db, parsed.file.scores);
  return { ...summarize(parsed.file, parsed.invalid, index), uploadId };
}

function addableRows(file: ScoreTransferFile, index: ReturnType<typeof buildTransferIndex>): ScoreTransferRow[] {
  return file.scores.filter((score) => {
    const kind = classifyTransferScore(fingerOf(score), index);
    return kind === "add" || kind === "add-current-version";
  });
}

function toWritePayload(rows: ScoreTransferRow[]) {
  return {
    rows: rows.map((row) => ({
      scoreId: row.onlineId,
      legacyScoreId: row.legacyOnlineId,
      beatmapOnlineId: row.beatmapOnlineId,
      checksum: row.beatmapMd5,
      beatmapHash: row.beatmapHash,
      accuracy: row.accuracy,
      pp: row.pp,
      maxCombo: row.maxCombo,
      combo: row.combo,
      totalScore: row.totalScore,
      totalScoreWithoutMods: row.totalScoreWithoutMods,
      legacyTotalScore: row.legacyTotalScore,
      rank: row.rank,
      modsJson: row.mods || "[]",
      statisticsJson: row.statistics,
      maximumStatisticsJson: row.maximumStatistics,
      endedAtMs: row.playedAt,
      username: row.username ?? "",
      userOnlineId: row.userOnlineId ?? 0,
      ruleset: row.ruleset,
      isLegacy: row.isLegacy,
      clientVersion: row.clientVersion ?? "",
    })),
  };
}

function parseCliResult(stdout: string): TransferWriteResult {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("RESULT "));
  if (!line) return { ok: false, error: "Score write produced no result", code: "other" };
  const parsed = JSON.parse(line.slice("RESULT ".length)) as TransferWriteResult & {
    ok: boolean;
    error?: string;
    code?: string;
  };
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error ?? "Score write failed",
      code: parsed.code === "locked" || parsed.code === "schema_mismatch" ? parsed.code : "other",
    };
  }
  return parsed;
}

/** Clears the timer. `onTimeout` runs once if the timer fires first. */
export function armProcessTimeout(
  kill: () => void,
  timeoutMs: number,
  onTimeout: () => void,
): () => void {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    kill();
    onTimeout();
  }, timeoutMs);
  return () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };
}

function runWriteCli(payloadPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "src/write-score-transfer-once.ts", payloadPath],
      {
        cwd: realmReaderDir(),
        env: { ...process.env, DB_PATH: process.env.DB_PATH ?? defaultDbPath() },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clear();
      fn();
    };
    const clear = armProcessTimeout(
      () => {
        child.kill("SIGKILL");
      },
      WRITE_CLI_TIMEOUT_MS,
      () => finish(() => reject(new Error("Score write timed out"))),
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => finish(() => reject(err)));
    child.on("close", (code) => {
      finish(() => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    });
  });
}

export async function commitScoreTransfer(
  db: Db,
  uploadId: string,
  store: UploadStore = {},
): Promise<TransferWriteResult> {
  if (!safeUploadId(uploadId)) {
    return { ok: false, error: "Choose the score file again.", code: "other" };
  }
  const lease = tryAcquireRealmWriteLock(db, "score_transfer_commit");
  if (!lease) return { ok: false, error: realmWriteBusyMessage(), code: "in_flight" };
  try {
    return await runCommit(db, lease, uploadId, store);
  } finally {
    await lease.release();
  }
}

async function runCommit(
  db: Db,
  lease: RealmWriteLease,
  uploadId: string,
  store: UploadStore,
): Promise<TransferWriteResult> {
  const stored = scoreTransferUploadFile(uploadId, store.dir);
  if (!stored || !existsSync(stored)) {
    return { ok: false, error: "Choose the score file again.", code: "other" };
  }
  try {
    if (Date.now() - statSync(stored).mtimeMs > UPLOAD_TTL_MS) {
      rmSync(path.dirname(stored), { recursive: true, force: true });
      return { ok: false, error: "Choose the score file again.", code: "other" };
    }
  } catch {
    return { ok: false, error: "Choose the score file again.", code: "other" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stored, "utf8"));
  } catch {
    return { ok: false, error: "This file is not a Roxysu score transfer.", code: "other" };
  }
  const parsed = parseScoreTransferFile(raw);
  if ("error" in parsed) return { ok: false, error: parsed.error, code: "other" };
  const index = await loadIndex(db, parsed.file.scores);
  const payload = toWritePayload(addableRows(parsed.file, index));
  if (payload.rows.length === 0) {
    return { ok: false, error: "No scores waiting to add.", code: "other" };
  }

  await lease.pauseExtraction();
  try {
    let result: TransferWriteResult;
    if (!isBunRuntime()) {
      const modPath = path.join(realmReaderDir(), "src", "writeScoreTransfer.ts");
      const packaged = path.join(realmReaderDir(), "writeScoreTransfer.js");
      const target = existsSync(packaged) ? packaged : modPath;
      const mod = await import(pathToFileURL(target).href);
      const { resolveRealmPath, getCachedOsuDataOverride, resolveOsuDataPath } = await import(
        "../shared/osu-paths"
      );
      const dataPath = resolveOsuDataPath(getCachedOsuDataOverride()).resolved;
      const realmPath = process.env.REALM_PATH?.trim() || resolveRealmPath(dataPath);
      result = mod.runScoreTransferWrite(
        db,
        process.env.DB_PATH ?? defaultDbPath(),
        realmPath,
        payload,
      );
    } else {
      const tempDir = mkdtempSync(path.join(tmpdir(), "roxysu-score-transfer-"));
      const payloadPath = path.join(tempDir, "payload.json");
      try {
        writeFileSync(payloadPath, JSON.stringify(payload));
        const { stdout, stderr, exitCode } = await runWriteCli(payloadPath);
        if (exitCode !== 0 && !stdout.includes("RESULT ")) {
          return {
            ok: false,
            error: stderr.trim() || stdout.trim() || "Score write failed",
            code: "other",
          };
        }
        result = parseCliResult(stdout);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Score write failed",
          code: "other",
        };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
    if (result.ok) rmSync(path.dirname(stored), { recursive: true, force: true });
    return result;
  } finally {
    await lease.release();
  }
}
