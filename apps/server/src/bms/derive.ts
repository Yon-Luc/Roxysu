import {
  bmsScoreDetails,
  bmsSyncQueue,
  scores,
} from "@roxysu/db/schema";
import { BMS_AUTO_UPLOAD_KEY } from "@roxysu/db/settings-keys";
import { interpretBmsScore } from "@roxysu/db/bms";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@roxysu/db/types";
import { readSetting } from "./settings";

const PAGE = 200;

function judgementJson(value: number | null): number | null {
  return value;
}

/**
 * Rebuild BMS details from raw scores. Does not touch the upload queue state
 * of rows that already exist.
 */
export async function deriveBmsScores(
  db: Db,
  scoreIds?: string[] | null,
): Promise<number> {
  if (scoreIds != null && scoreIds.length === 0) return 0;
  let after = "";
  let written = 0;
  const derivedIds: string[] = [];

  while (true) {
    const filters = [eq(scores.rulesetShortName, "bms"), gt(scores.id, after)];
    if (scoreIds != null) filters.push(inArray(scores.id, scoreIds));
    const rows = await db
      .select({
        id: scores.id,
        deletePending: scores.deletePending,
        totalScore: scores.totalScore,
        accuracy: scores.accuracy,
        statistics: scores.statistics,
        maximumStatistics: scores.maximumStatistics,
        mods: scores.mods,
      })
      .from(scores)
      .where(and(...filters))
      .orderBy(asc(scores.id))
      .limit(PAGE);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.deletePending) {
        await db
          .delete(bmsScoreDetails)
          .where(eq(bmsScoreDetails.scoreId, row.id));
        continue;
      }
      const interpreted = interpretBmsScore({
        statistics: row.statistics,
        maximumStatistics: row.maximumStatistics,
        mods: row.mods,
        totalScore: row.totalScore,
        accuracy: row.accuracy,
      });
      const values = {
        scoreId: row.id,
        exScore: interpreted.exScore,
        maxExScore: interpreted.maxExScore,
        normalizedScore: interpreted.normalizedScore,
        accuracy: interpreted.accuracy,
        pgreat: judgementJson(interpreted.judgements.pgreat),
        great: judgementJson(interpreted.judgements.great),
        good: judgementJson(interpreted.judgements.good),
        bad: judgementJson(interpreted.judgements.bad),
        poor: judgementJson(interpreted.judgements.poor),
        miss: judgementJson(interpreted.judgements.miss),
        variantId: interpreted.variantId,
        gaugeId: interpreted.gaugeId,
        comboLampId: interpreted.comboLampId,
        clearLampId: null,
        djGrade: interpreted.djGrade,
        modAcronyms: JSON.stringify(interpreted.modAcronyms),
        autoplay: interpreted.autoplay,
        updatedAt: new Date(),
      };
      await db
        .insert(bmsScoreDetails)
        .values(values)
        .onConflictDoUpdate({
          target: bmsScoreDetails.scoreId,
          set: {
            exScore: values.exScore,
            maxExScore: values.maxExScore,
            normalizedScore: values.normalizedScore,
            accuracy: values.accuracy,
            pgreat: values.pgreat,
            great: values.great,
            good: values.good,
            bad: values.bad,
            poor: values.poor,
            miss: values.miss,
            variantId: values.variantId,
            gaugeId: values.gaugeId,
            comboLampId: values.comboLampId,
            clearLampId: null,
            djGrade: values.djGrade,
            modAcronyms: values.modAcronyms,
            autoplay: values.autoplay,
            updatedAt: values.updatedAt,
          },
        });
      written += 1;
      derivedIds.push(row.id);
    }

    after = rows[rows.length - 1]!.id;
    if (rows.length < PAGE) break;
  }

  if ((await readSetting(db, BMS_AUTO_UPLOAD_KEY)) === "1" && derivedIds.length > 0) {
    await enqueueNewScores(db, derivedIds);
  }
  return written;
}

/** Insert pending queue rows. Existing rows, including synced and rejected, stay put. */
export async function enqueueNewScores(
  db: Db,
  scoreIds: string[],
): Promise<number> {
  if (scoreIds.length === 0) return 0;
  const details = await db
    .select({
      scoreId: bmsScoreDetails.scoreId,
      autoplay: bmsScoreDetails.autoplay,
    })
    .from(bmsScoreDetails)
    .where(inArray(bmsScoreDetails.scoreId, scoreIds));
  let inserted = 0;
  for (const row of details) {
    if (row.autoplay) continue;
    const result = await db
      .insert(bmsSyncQueue)
      .values({
        scoreId: row.scoreId,
        state: "pending",
        attempts: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ scoreId: bmsSyncQueue.scoreId });
    inserted += result.length;
  }
  return inserted;
}
