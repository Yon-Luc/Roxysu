import {
  and,
  eq,
  isNotNull,
  settings,
  mastery,
  scores,
  scoreMetrics,
  type Db,
} from "@roxysu/db/client.bun";
import { publish } from "../../shared/events";
import {
  DEFAULT_MASTERY_FORMULA,
  getFormula,
  listFormulas,
} from "./registry";
import type { MasteryComputeInput, MasteryScoreInput } from "./types";

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

export async function runMasteryEngine(db: Db): Promise<void> {
  const formulaId = await getActiveFormulaId(db);
  const formula = getFormula(formulaId)!;

  const scoreRows = await db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      playedAt: scores.playedAt,
      retryIndex: scoreMetrics.retryIndex,
    })
    .from(scores)
    .leftJoin(scoreMetrics, eq(scores.id, scoreMetrics.scoreId))
    .where(and(eq(scores.deletePending, false), isNotNull(scores.beatmapId)));

  type Agg = {
    scores: MasteryScoreInput[];
    maxRetryIndex: number;
    bestAccuracy: number | null;
    bestPp: number | null;
    lastPlayedAt: Date | null;
  };

  const byBeatmap = new Map<string, Agg>();
  for (const row of scoreRows) {
    if (!row.beatmapId) continue;
    let agg = byBeatmap.get(row.beatmapId);
    if (!agg) {
      agg = {
        scores: [],
        maxRetryIndex: 0,
        bestAccuracy: null,
        bestPp: null,
        lastPlayedAt: null,
      };
      byBeatmap.set(row.beatmapId, agg);
    }
    agg.scores.push({
      accuracy: row.accuracy,
      pp: row.pp,
      playedAt: row.playedAt,
    });
    agg.maxRetryIndex = Math.max(agg.maxRetryIndex, row.retryIndex ?? 0);
    if (agg.bestAccuracy == null || row.accuracy > agg.bestAccuracy) {
      agg.bestAccuracy = row.accuracy;
    }
    if (row.pp != null && (agg.bestPp == null || row.pp > agg.bestPp)) {
      agg.bestPp = row.pp;
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
      lastPlayedAt: agg.lastPlayedAt,
      formulaId,
      updatedAt: now,
    };
  });

  await db.delete(mastery);
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    await db.insert(mastery).values(batch);
  }

  publish({ type: "mastery.updated" });
}

export { listFormulas, getFormula };
export type { MasteryFormula } from "./types";
