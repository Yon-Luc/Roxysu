import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  beatmaps,
  onlineScoreCandidates,
  scores,
  settings,
} from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import { defaultDbPath } from "@roxysu/db/path";
import type { Db } from "@roxysu/db/types";
import { resolveScoresUsernames } from "../analytics/scoreUsername";
import { resolveHubBaseUrl } from "../hubUrl";
import {
  classifyRankedBest,
  endedAtMs,
  type LocalBeatmap,
  type RankedBest,
} from "./match";

const PAUSE_SETTLE_MS = 2_000;
const RANK: Record<string, number> = {
  F: -1,
  D: 0,
  C: 1,
  B: 2,
  A: 3,
  S: 4,
  SH: 5,
  X: 6,
  XH: 7,
};

export type PullPreview = {
  osuId: number;
  username: string;
  ruleset: string;
  found: number;
  already: number;
  add: number;
  currentVersion: number;
  skipped: number;
  missingSetIds: number[];
  fromCache: boolean;
  budget: unknown;
};

type WriteResult =
  | { ok: true; added: number; skipped: number; backupPath: string }
  | { ok: false; error: string; code: "locked" | "schema_mismatch" | "in_flight" | "other" };

let writeInFlight: Promise<WriteResult> | null = null;

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

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export type LocalOsuPlayer = {
  username: string;
  osuId: number;
  count: number;
};

export async function listLocalOsuPlayers(db: Db): Promise<LocalOsuPlayer[]> {
  const rows = await db
    .select({
      username: scores.userUsername,
      osuId: sql<number>`max(${scores.userOnlineId})`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(scores)
    .where(
      and(
        eq(scores.deletePending, false),
        gt(scores.userOnlineId, 1),
        isNotNull(scores.userUsername),
        ne(scores.userUsername, ""),
      ),
    )
    .groupBy(scores.userUsername)
    .orderBy(desc(sql`count(*)`));
  return rows.filter(
    (row): row is LocalOsuPlayer =>
      typeof row.username === "string" &&
      row.username.length > 0 &&
      row.osuId > 1,
  );
}

export async function resolveLocalOsuUser(
  db: Db,
  username?: string,
): Promise<{ osuId: number; username: string } | { error: string }> {
  const players = await listLocalOsuPlayers(db);
  if (players.length === 0) {
    return { error: "No osu! id on local scores yet." };
  }
  const wanted = username?.trim();
  if (wanted) {
    const match = players.find((player) => player.username === wanted);
    if (!match) return { error: `No osu! id on local scores for ${wanted}.` };
    return { osuId: match.osuId, username: match.username };
  }
  if (players.length === 1) {
    return { osuId: players[0]!.osuId, username: players[0]!.username };
  }
  const filtered = await resolveScoresUsernames(db);
  if (filtered?.length === 1) {
    const match = players.find((player) => player.username === filtered[0]);
    if (match) return { osuId: match.osuId, username: match.username };
  }
  return { error: "Pick a player below." };
}

async function hubPull(
  hubJwt: string,
  ruleset: string,
  force: boolean,
): Promise<{
  osuId: number;
  username: string;
  scores: RankedBest[];
  fromCache: boolean;
  budget: unknown;
}> {
  const url = new URL(`${resolveHubBaseUrl()}/osu/scores/best`);
  url.searchParams.set("ruleset", ruleset);
  if (force) url.searchParams.set("force", "1");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${hubJwt}`, Accept: "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
    osuId?: number;
    username?: string;
    scores?: RankedBest[];
    fromCache?: boolean;
    budget?: unknown;
  };
  if (!res.ok) {
    throw new Error(data.message ?? `Hub score pull failed (${res.status})`);
  }
  if (!data.osuId || !Array.isArray(data.scores)) {
    throw new Error("Hub score pull returned an unexpected body");
  }
  return {
    osuId: data.osuId,
    username: data.username ?? "",
    scores: data.scores,
    fromCache: data.fromCache === true,
    budget: data.budget ?? null,
  };
}

async function resolveMissingSetIds(beatmapIds: number[]): Promise<number[]> {
  const unique = [...new Set(beatmapIds.filter((id) => id > 0))].slice(0, 200);
  const sets = new Set<number>();
  const chunkSize = 8;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const found = await Promise.all(
      chunk.map(async (id) => {
        try {
          const res = await fetch(`https://mirror.hinamizawa.ai/v3/osu/beatmaps/b/${id}`, {
            headers: {
              accept: "application/json",
              "user-agent": "roxysu/0.1.3 (+https://github.com/Yon-Luc/Roxysu)",
            },
            signal: AbortSignal.timeout(12_000),
          });
          if (!res.ok) return 0;
          const data = (await res.json()) as { beatmapset_id?: number };
          return data.beatmapset_id ?? 0;
        } catch {
          return 0;
        }
      }),
    );
    for (const setId of found) {
      if (setId > 0) sets.add(setId);
    }
  }
  return [...sets];
}

function rankInt(rank: string): number {
  return RANK[rank.toUpperCase()] ?? 0;
}

export async function previewOnlineScores(
  db: Db,
  input: { hubJwt: string; ruleset: string; force?: boolean; username?: string },
): Promise<PullPreview | { error: string; code: string }> {
  const local = await resolveLocalOsuUser(db, input.username);
  if ("error" in local) return { error: local.error, code: "local_user" };
  const pulled = await hubPull(input.hubJwt, input.ruleset, input.force === true);
  if (pulled.osuId !== local.osuId) {
    return {
      error: `Hub account is ${pulled.username || pulled.osuId}, but lazer scores belong to ${local.username}. Log in as ${local.username} so added scores show in-game.`,
      code: "account_mismatch",
    };
  }

  const localScores = await db
    .select({
      onlineId: scores.onlineId,
      legacyOnlineId: scores.legacyOnlineId,
      beatmapOnlineId: beatmaps.onlineId,
      playedAt: scores.playedAt,
      totalScore: scores.totalScore,
      legacyTotalScore: scores.legacyTotalScore,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(and(eq(scores.deletePending, false), eq(scores.userUsername, local.username)));

  const onlineIds = new Set<number>();
  const legacyIds = new Set<number>();
  const fingerprints = localScores.map((row) => {
    if (row.onlineId > 0) onlineIds.add(row.onlineId);
    if (row.legacyOnlineId > 0) legacyIds.add(row.legacyOnlineId);
    const played = row.playedAt instanceof Date ? row.playedAt.getTime() : Number(row.playedAt);
    return {
      onlineId: row.onlineId,
      legacyOnlineId: row.legacyOnlineId,
      beatmapOnlineId: row.beatmapOnlineId,
      playedAtMs: Number.isFinite(played) ? played : 0,
      totalScore: row.totalScore,
      legacyTotalScore: row.legacyTotalScore,
    };
  });

  const beatmapIds = [...new Set(pulled.scores.map((score) => score.beatmapId))];
  const beatmapsByOnlineId = new Map<number, LocalBeatmap[]>();
  for (let i = 0; i < beatmapIds.length; i += 400) {
    const chunk = beatmapIds.slice(i, i + 400);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({
        id: beatmaps.id,
        onlineId: beatmaps.onlineId,
        md5Hash: beatmaps.md5Hash,
        hash: beatmaps.hash,
        totalObjectCount: beatmaps.totalObjectCount,
        rulesetShortName: beatmaps.rulesetShortName,
      })
      .from(beatmaps)
      .where(and(inArray(beatmaps.onlineId, chunk), eq(beatmaps.rulesetShortName, input.ruleset)));
    for (const row of rows) {
      const list = beatmapsByOnlineId.get(row.onlineId) ?? [];
      list.push(row);
      beatmapsByOnlineId.set(row.onlineId, list);
    }
  }

  let already = 0;
  let add = 0;
  let currentVersion = 0;
  let skipped = 0;
  const missingSetIds = new Set<number>();
  const missingBeatmapIds: number[] = [];
  const candidates: Array<typeof onlineScoreCandidates.$inferInsert> = [];
  const now = new Date();

  for (const score of pulled.scores) {
    const classified = classifyRankedBest(score, {
      onlineIds,
      legacyIds,
      fingerprints,
      beatmapsByOnlineId,
    });
    if (classified.kind === "already") {
      already += 1;
      continue;
    }
    if (classified.kind === "skipped" || !classified.beatmap) {
      skipped += 1;
      if (score.beatmapsetId && score.beatmapsetId > 0) missingSetIds.add(score.beatmapsetId);
      else missingBeatmapIds.push(score.beatmapId);
      continue;
    }
    if (classified.kind === "add-current-version") currentVersion += 1;
    else add += 1;
    candidates.push({
      scoreId: score.id,
      ruleset: input.ruleset,
      osuUserId: local.osuId,
      beatmapOnlineId: score.beatmapId,
      versionMismatch: classified.kind === "add-current-version",
      payloadJson: JSON.stringify({
        scoreId: score.id,
        legacyScoreId: score.legacyScoreId ?? -1,
        beatmapOnlineId: score.beatmapId,
        checksum: score.checksum,
        accuracy: score.accuracy,
        pp: score.pp,
        maxCombo: score.maxCombo,
        totalScore: score.totalScore,
        totalScoreWithoutMods: score.totalScoreWithoutMods,
        legacyTotalScore: score.legacyTotalScore,
        rank: rankInt(score.rank),
        modsJson: score.modsJson,
        statistics: score.statistics,
        maximumStatistics: score.maximumStatistics,
        objectCount: classified.beatmap.totalObjectCount,
        endedAtMs: endedAtMs(score.endedAt),
        username: local.username,
        userOnlineId: local.osuId,
        ruleset: input.ruleset,
        isLegacy: score.isLegacy,
      }),
      createdAt: now,
    });
  }

  await db.delete(onlineScoreCandidates);
  for (let i = 0; i < candidates.length; i += 80) {
    const slice = candidates.slice(i, i + 80);
    if (slice.length > 0) await db.insert(onlineScoreCandidates).values(slice);
  }

  return {
    osuId: local.osuId,
    username: local.username,
    ruleset: input.ruleset,
    found: pulled.scores.length,
    already,
    add,
    currentVersion,
    skipped,
    missingSetIds: [
      ...missingSetIds,
      ...(await resolveMissingSetIds(missingBeatmapIds)),
    ],
    fromCache: pulled.fromCache,
    budget: pulled.budget,
  };
}

function parseCliResult(stdout: string): WriteResult {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("RESULT "));
  if (!line) {
    return { ok: false, error: "Score write produced no result", code: "other" };
  }
  const parsed = JSON.parse(line.slice("RESULT ".length)) as WriteResult & {
    ok: boolean;
    error?: string;
    code?: WriteResult extends { ok: false } ? WriteResult["code"] : never;
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

function runWriteCli(payloadPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "src/write-online-scores-once.ts", payloadPath],
      {
        cwd: realmReaderDir(),
        env: { ...process.env, DB_PATH: process.env.DB_PATH ?? defaultDbPath() },
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

export async function commitOnlineScores(db: Db): Promise<WriteResult> {
  if (writeInFlight) {
    return { ok: false, error: "Score write already running", code: "in_flight" };
  }
  writeInFlight = runCommit(db);
  try {
    return await writeInFlight;
  } finally {
    writeInFlight = null;
  }
}

async function runCommit(db: Db): Promise<WriteResult> {
  const rows = await db.select().from(onlineScoreCandidates);
  if (rows.length === 0) {
    return { ok: false, error: "No scores waiting to add. Pull again first.", code: "other" };
  }
  const first = JSON.parse(rows[0]!.payloadJson) as { userOnlineId: number; username: string };
  const payload = {
    userOnlineId: first.userOnlineId,
    username: first.username,
    countryCode: null,
    rows: rows.map((row) => JSON.parse(row.payloadJson)),
  };

  await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "1");
  await sleep(PAUSE_SETTLE_MS);
  try {
    let result: WriteResult;
    if (!isBunRuntime()) {
      const modPath = path.join(realmReaderDir(), "src", "writeOnlineScores.ts");
      const packaged = path.join(realmReaderDir(), "writeOnlineScores.js");
      const target = existsSync(packaged) ? packaged : modPath;
      const mod = await import(pathToFileURL(target).href);
      const { resolveRealmPath } = await import("../shared/osu-paths");
      const { getCachedOsuDataOverride, resolveOsuDataPath } = await import("../shared/osu-paths");
      const dataPath = resolveOsuDataPath(getCachedOsuDataOverride()).resolved;
      const realmPath = process.env.REALM_PATH?.trim() || resolveRealmPath(dataPath);
      result = mod.runOnlineScoreWrite(db, process.env.DB_PATH ?? defaultDbPath(), realmPath, payload);
    } else {
      const tempDir = mkdtempSync(path.join(tmpdir(), "roxysu-score-pull-"));
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
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
    if (result.ok) await db.delete(onlineScoreCandidates);
    return result;
  } finally {
    await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "0");
  }
}

export async function candidateSummary(db: Db) {
  const rows = await db.select().from(onlineScoreCandidates);
  const currentVersion = rows.filter((row) => row.versionMismatch).length;
  return {
    waiting: rows.length,
    currentVersion,
    add: rows.length - currentVersion,
    ruleset: rows[0]?.ruleset ?? null,
    osuUserId: rows[0]?.osuUserId ?? null,
  };
}
