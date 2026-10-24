import type { Db } from "@roxysu/db/types";
import { mastery, scores } from "@roxysu/db/schema";
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
import { computeSimpleMastery } from "./formulas/simple";
import type { MasteryComputeInput } from "./types";
import { loadManiaPpCurves, resolveScorePp } from "../../mania-rating/estimateScorePp";

const MASTERY_FORMULA_ID = "simple";

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
    })
    .from(scores)
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
    playCount: number;
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
        playCount: 0,
        bestAccuracy: null,
        bestPp: null,
        bestScore: null,
        bestMisses: null,
        lastPlayedAt: null,
      };
      byBeatmap.set(row.beatmapId, agg);
    }
    agg.playCount += 1;
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
      playCount: agg.playCount,
      bestAccuracy: agg.bestAccuracy,
      bestPp: agg.bestPp,
      lastPlayedAt: agg.lastPlayedAt,
    };
    return {
      beatmapId,
      level: computeSimpleMastery(input),
      playCount: agg.playCount,
      bestAccuracy: agg.bestAccuracy,
      bestPp: agg.bestPp,
      bestScore: agg.bestScore,
      bestMisses: agg.bestMisses,
      lastPlayedAt: agg.lastPlayedAt,
      formulaId: MASTERY_FORMULA_ID,
      updatedAt: now,
    };
  });

  const batches: (typeof rows)[] = [];
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
