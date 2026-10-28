import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { beatmaps } from "@roxysu/db/schema";
import type { Db } from "@roxysu/db/types";
import { parseOsuChart } from "@roxysu/osu-chart";
import {
  beatmapFromOsuChart,
  calculateManiaDifficulty,
} from "@roxysu/mania-difficulty";
import { QueryParseError, searchBeatmaps } from "../query-language";
import { resolveLazerFilePath } from "../shared/lazer-files";
import { runCsharpReference } from "./csharp";

export const PARITY_REL_TOL = 0.02;
export const PARITY_ABS_TOL = 0.05;
export const PARITY_LIMIT_DEFAULT = 16;
export const PARITY_LIMIT_MAX = 40;

export const SKILL_KEYS = [
  "starRating",
  "starRatingSs",
  "speed",
  "technical",
  "jack",
  "coordination",
  "release",
  "variety",
] as const;

export type SkillKey = (typeof SKILL_KEYS)[number];

export type SkillSnapshot = Record<SkillKey, number | null> & {
  noteCount: number | null;
  holdNoteCount: number | null;
  lnRatio: number | null;
  greatHitWindow: number | null;
};

export type SkillDelta = {
  abs: number;
  rel: number;
  ok: boolean;
};

export function withinTolerance(actual: number, expected: number): boolean {
  const abs = Math.abs(actual - expected);
  const rel = expected !== 0 ? abs / Math.abs(expected) : abs;
  return abs <= PARITY_ABS_TOL || rel <= PARITY_REL_TOL;
}

export function skillDelta(
  ts: number | null,
  csharp: number | null,
): SkillDelta | null {
  if (ts == null || csharp == null || !Number.isFinite(ts) || !Number.isFinite(csharp)) {
    return null;
  }
  const abs = ts - csharp;
  const rel = csharp !== 0 ? abs / Math.abs(csharp) : abs;
  return {
    abs,
    rel,
    ok: withinTolerance(ts, csharp),
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function snapshotFromCsharp(raw: {
  starRating: number;
  starRatingSs: number | null;
  attributes: Record<string, number>;
}): SkillSnapshot {
  const a = raw.attributes;
  return {
    starRating: raw.starRating,
    starRatingSs: raw.starRatingSs,
    speed: num(a.speed_difficulty),
    technical: num(a.technical_difficulty),
    jack: num(a.jack_difficulty),
    coordination: num(a.coordination_difficulty),
    release: num(a.release_difficulty),
    variety: num(a.variety),
    noteCount: num(a.note_count),
    holdNoteCount: num(a.hold_note_count),
    lnRatio: num(a.ln_ratio),
    greatHitWindow: num(a.great_hit_window),
  };
}

function snapshotFromTs(text: string): SkillSnapshot {
  const odMatch = text.match(/OverallDifficulty:\s*([\d.]+)/);
  const od = odMatch ? Number(odMatch[1]) : 8;
  const chart = parseOsuChart(text);
  if (chart.gameMode !== "3" && chart.status === "NotMania") {
    throw new Error("Beatmap mode is not mania");
  }
  const result = calculateManiaDifficulty(beatmapFromOsuChart(chart, od));
  return {
    starRating: result.starRating,
    starRatingSs: result.starRatingSs ?? null,
    speed: result.speedDifficulty ?? null,
    technical: result.technicalDifficulty ?? null,
    jack: result.jackDifficulty ?? null,
    coordination: result.coordinationDifficulty ?? null,
    release: result.releaseDifficulty ?? null,
    variety: result.variety ?? null,
    noteCount: result.noteCount ?? null,
    holdNoteCount: result.holdNoteCount ?? null,
    lnRatio: result.lnRatio ?? null,
    greatHitWindow: result.greatHitWindow ?? null,
  };
}

export type ParityRow = {
  id: string;
  title: string | null;
  difficultyName: string | null;
  keyCount: number | null;
  csharp: SkillSnapshot | null;
  ts: SkillSnapshot | null;
  deltas: Partial<Record<SkillKey, SkillDelta>>;
  countsMatch: boolean;
  outside: boolean;
  error: string | null;
};

export type ParityReport = {
  query: string;
  sha: string;
  total: number;
  compared: number;
  skipped: number;
  tolerance: { rel: number; abs: number };
  outside: number;
  worst: { id: string; metric: SkillKey; rel: number } | null;
  items: ParityRow[];
};

async function mapPool<T, R>(
  items: T[],
  width: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]!, index);
    }
  }
  const n = Math.max(1, Math.min(width, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function worstRel(row: ParityRow): number {
  let worst = 0;
  for (const key of SKILL_KEYS) {
    const delta = row.deltas[key];
    if (!delta) continue;
    worst = Math.max(worst, Math.abs(delta.rel));
  }
  return worst;
}

export async function compareManiaParity(
  db: Db,
  options: {
    query: string;
    limit: number;
    sha: string;
    dll: string;
  },
): Promise<ParityReport> {
  const limit = Math.min(
    PARITY_LIMIT_MAX,
    Math.max(1, Math.floor(options.limit)),
  );
  let found: ReturnType<typeof searchBeatmaps>;
  try {
    found = searchBeatmaps(db, options.query, {
      page: 1,
      pageSize: limit,
      sortBy: "stars",
      sortDir: "desc",
    });
  } catch (err) {
    if (err instanceof QueryParseError) throw err;
    throw err;
  }

  const ids = found.items.map((item) => item.id);
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: beatmaps.id,
            hash: beatmaps.hash,
            title: beatmaps.title,
            difficultyName: beatmaps.difficultyName,
            ruleset: beatmaps.rulesetShortName,
            keyCount: beatmaps.circleSize,
            objects: beatmaps.totalObjectCount,
          })
          .from(beatmaps)
          .where(inArray(beatmaps.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));

  let skipped = 0;
  const targets = ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row || row.ruleset !== "mania" || row.objects < 8 || !row.hash) {
      skipped += 1;
      return [];
    }
    const filePath = resolveLazerFilePath(row.hash);
    if (!filePath) {
      skipped += 1;
      return [];
    }
    return [{ row, filePath }];
  });

  const items = await mapPool(targets, 3, async (target): Promise<ParityRow> => {
    const base = {
      id: target.row.id,
      title: target.row.title,
      difficultyName: target.row.difficultyName,
      keyCount: target.row.keyCount,
    };
    try {
      const text = readFileSync(target.filePath, "utf8");
      const ts = snapshotFromTs(text);
      const csharp = snapshotFromCsharp(
        await runCsharpReference({
          dll: options.dll,
          sha: options.sha,
          beatmapPath: target.filePath,
        }),
      );
      const deltas: ParityRow["deltas"] = {};
      let outside = false;
      for (const key of SKILL_KEYS) {
        const delta = skillDelta(ts[key], csharp[key]);
        if (!delta) continue;
        deltas[key] = delta;
        if (!delta.ok) outside = true;
      }
      const countsMatch =
        ts.noteCount === csharp.noteCount &&
        ts.holdNoteCount === csharp.holdNoteCount;
      if (!countsMatch) outside = true;
      return {
        ...base,
        csharp,
        ts,
        deltas,
        countsMatch,
        outside,
        error: null,
      } satisfies ParityRow;
    } catch (err) {
      return {
        ...base,
        csharp: null,
        ts: null,
        deltas: {},
        countsMatch: false,
        outside: true,
        error: err instanceof Error ? err.message : String(err),
      } satisfies ParityRow;
    }
  });

  items.sort((a, b) => worstRel(b) - worstRel(a));
  let worst: ParityReport["worst"] = null;
  for (const item of items) {
    for (const key of SKILL_KEYS) {
      const delta = item.deltas[key];
      if (!delta || delta.ok) continue;
      if (!worst || Math.abs(delta.rel) > Math.abs(worst.rel)) {
        worst = { id: item.id, metric: key, rel: delta.rel };
      }
    }
  }

  return {
    query: options.query,
    sha: options.sha,
    total: found.total,
    compared: items.length,
    skipped,
    tolerance: { rel: PARITY_REL_TOL, abs: PARITY_ABS_TOL },
    outside: items.filter((item) => item.outside).length,
    worst,
    items,
  };
}
