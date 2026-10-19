
import type { Db } from "@roxysu/db/types";
import { mastery, scoreMetrics, scores, settings } from "@roxysu/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { publish } from "../../shared/events";
import { parseScoreStatistics } from "../../scores/parseStatistics";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../scoreUsername";
import {
  DEFAULT_MASTERY_FORMULA,
  getFormula,
  listFormulas,
} from "./registry";
import type { MasteryComputeInput, MasteryScoreInput } from "./types";
import { loadManiaPpCurves, resolveScorePp } from "../../mania-rating/estimateScorePp";

export const MASTERY_FORMULA_SETTING = "mastery.formula";

export async function getActiveFormulaId(db: Db): Promise<string> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, MASTERY_FORMULA_SETTING))
    .limit(1);
  const id = row?.value ?? DEFAULT_MASTERY_FORMULA;
  return getFormula(id) ? id : DEFAULT_MASTERY_FORMULA;
}

export async function setActiveFormulaId(db: Db, formulaId: string): Promise<void> {
  if (!getFormula(formulaId)) {
    throw new Error(`Unknown mastery formula: ${formulaId}`);
  }
  await db
    .insert(settings)
    .values({ key: MASTERY_FORMULA_SETTING, value: formulaId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: formulaId },
    });
}

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

export type MasteryEngineOptions = {
  /** When set, only recompute these beatmaps (delete+upsert partition). */
  beatmapIds?: string[];
};

export async function runMasteryEngine(
  db: Db,
  options?: MasteryEngineOptions,
): Promise<void> {
  const formulaId = await getActiveFormulaId(db);
  const formula = getFormula(formulaId)!;
  const scopeIds = options?.beatmapIds;
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const usernameCond = scoresUsernameCondition(usernames);
  const gamemodeCond = scoresGamemodeCondition(gamemode);

  const scoreQuery = db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      totalScore: scores.totalScore,
      statistics: scores.statistics,
      mods: scores.mods,
      rulesetShortName: scores.rulesetShortName,
      playedAt: scores.playedAt,
      retryIndex: scoreMetrics.retryIndex,
    })
    .from(scores)
    .leftJoin(scoreMetrics, eq(scores.id, scoreMetrics.scoreId))
    .where(
      scopeIds && scopeIds.length > 0
        ? and(
            eq(scores.deletePending, false),
            isNotNull(scores.beatmapId),
            inArray(scores.beatmapId, scopeIds),
            usernameCond,
            gamemodeCond,
          )
        : and(
            eq(scores.deletePending, false),
            isNotNull(scores.beatmapId),
            usernameCond,
            gamemodeCond,
          ),
    );

  const scoreRows = await scoreQuery;
  const curves = await loadManiaPpCurves(
    db,
    scoreRows
      .map((row) => row.beatmapId)
      .filter((beatmapId): beatmapId is string => beatmapId != null),
  );

  type Agg = {
    scores: MasteryScoreInput[];
    maxRetryIndex: number;
    bestAccuracy: number | null;
    bestPp: number | null;
    bestScore: number | null;
    bestMisses: number | null;
    lastPlayedAt: Date | null;
  };

  const byBeatmap = new Map<string, Agg>();
  for (const row of scoreRows) {
    if (!row.beatmapId) continue;
    const pp = resolveScorePp({
      pp: row.pp,
      accuracy: row.accuracy,
      mods: row.mods,
      rulesetShortName: row.rulesetShortName,
      curve: curves.get(row.beatmapId),
    });
    let agg = byBeatmap.get(row.beatmapId);
    if (!agg) {
      agg = {
        scores: [],
        maxRetryIndex: 0,
        bestAccuracy: null,
        bestPp: null,
        bestScore: null,
        bestMisses: null,
        lastPlayedAt: null,
      };
      byBeatmap.set(row.beatmapId, agg);
    }
    agg.scores.push({
      accuracy: row.accuracy,
      pp,
      playedAt: row.playedAt,
    });
    agg.maxRetryIndex = Math.max(agg.maxRetryIndex, row.retryIndex ?? 0);
    if (agg.bestAccuracy == null || row.accuracy > agg.bestAccuracy) {
      agg.bestAccuracy = row.accuracy;
    }
    if (pp != null && (agg.bestPp == null || pp > agg.bestPp)) {
      agg.bestPp = pp;
    }
    if (agg.bestScore == null || row.totalScore > agg.bestScore) {
      agg.bestScore = row.totalScore;
    }
    const misses = parseScoreStatistics(row.statistics)?.miss;
    if (misses != null && (agg.bestMisses == null || misses < agg.bestMisses)) {
      agg.bestMisses = misses;
    }
    const played = new Date(toMs(row.playedAt));
    if (!agg.lastPlayedAt || played > agg.lastPlayedAt) {
      agg.lastPlayedAt = played;
    }
  }

  const now = new Date();
  const rows = [...byBeatmap.entries()].map(([beatmapId, agg]) => {
    const input: MasteryComputeInput = {
      beatmapId,
      playCount: agg.scores.length,
      bestAccuracy: agg.bestAccuracy,
      bestPp: agg.bestPp,
      lastPlayedAt: agg.lastPlayedAt,
      scores: agg.scores,
      maxRetryIndex: agg.maxRetryIndex,
    };
    return {
      beatmapId,
      level: formula.compute(input),
      playCount: agg.scores.length,
      bestAccuracy: agg.bestAccuracy,
      bestPp: agg.bestPp,
      bestScore: agg.bestScore,
      bestMisses: agg.bestMisses,
      lastPlayedAt: agg.lastPlayedAt,
      formulaId,
      updatedAt: now,
    };
  });

  const batches = [];
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    if (batch.length > 0) batches.push(batch);
  }

  db.transaction((tx) => {
    if (scopeIds && scopeIds.length > 0) {
      tx.delete(mastery).where(inArray(mastery.beatmapId, scopeIds)).run();
    } else {
      tx.delete(mastery).run();
    }
    for (const batch of batches) {
      tx.insert(mastery).values(batch).run();
    }
  }, { behavior: "immediate" });

  publish({ type: "mastery.updated" });
}

export { listFormulas, getFormula };
export type { MasteryFormula } from "./types";
