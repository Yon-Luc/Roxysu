import type { Db } from "@roxysu/db/types";
import { beatmapManiaRatings } from "@roxysu/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { isNomodOrMirrorOnly } from "../replay/mods";
import { LAZER_MASTER_VERSION } from "./registry";
import {
  interpolatePpFromAccuracy,
  parsePpByAccuracy,
  type PpByAccuracy,
} from "./ppAccuracy";

export type ManiaPpCurve = {
  ppByAccuracy: PpByAccuracy | null;
  ppSs: number | null;
};

/** Prefer persisted Realm PP; otherwise estimate NM/MR mania PP from the lazer-master curve. */
export function resolveScorePp(input: {
  pp: number | null | undefined;
  accuracy: number;
  mods?: string | null;
  rulesetShortName?: string | null;
  curve?: ManiaPpCurve | null;
}): number | null {
  if (input.pp != null && Number.isFinite(input.pp)) return input.pp;

  const ruleset = (input.rulesetShortName ?? "").toLowerCase();
  if (ruleset && ruleset !== "mania") return null;
  if (!isNomodOrMirrorOnly(input.mods)) return null;
  if (!input.curve) return null;

  return interpolatePpFromAccuracy(
    input.curve.ppByAccuracy,
    input.accuracy,
    input.curve.ppSs,
  );
}

/** Load lazer-master PP-by-accuracy curves keyed by beatmap id. */
export async function loadManiaPpCurves(
  db: Db,
  beatmapIds?: string[],
  versionId: string = LAZER_MASTER_VERSION,
): Promise<Map<string, ManiaPpCurve>> {
  const out = new Map<string, ManiaPpCurve>();

  const rows =
    beatmapIds && beatmapIds.length > 0
      ? await db
          .select({
            beatmapId: beatmapManiaRatings.beatmapId,
            ppSs: beatmapManiaRatings.ppSs,
            ppByAccuracyJson: beatmapManiaRatings.ppByAccuracyJson,
          })
          .from(beatmapManiaRatings)
          .where(
            and(
              eq(beatmapManiaRatings.versionId, versionId),
              inArray(beatmapManiaRatings.beatmapId, beatmapIds),
            ),
          )
      : await db
          .select({
            beatmapId: beatmapManiaRatings.beatmapId,
            ppSs: beatmapManiaRatings.ppSs,
            ppByAccuracyJson: beatmapManiaRatings.ppByAccuracyJson,
          })
          .from(beatmapManiaRatings)
          .where(eq(beatmapManiaRatings.versionId, versionId));

  for (const row of rows) {
    const ppByAccuracy = parsePpByAccuracy(row.ppByAccuracyJson);
    if (ppByAccuracy == null && row.ppSs == null) continue;
    out.set(row.beatmapId, { ppByAccuracy, ppSs: row.ppSs ?? null });
  }

  return out;
}

/** Sync variant for raw-sql analytics paths that already hold a bun:sqlite handle. */
export function loadManiaPpCurvesSync(
  db: Db,
  versionId: string = LAZER_MASTER_VERSION,
): Map<string, ManiaPpCurve> {
  const rows = db.$client
    .query(
      `
      SELECT beatmap_id AS beatmapId, pp_ss AS ppSs, pp_by_accuracy_json AS ppByAccuracyJson
      FROM beatmap_mania_ratings
      WHERE version_id = ?
    `,
    )
    .all(versionId) as Array<{
    beatmapId: string;
    ppSs: number | null;
    ppByAccuracyJson: string | null;
  }>;

  const out = new Map<string, ManiaPpCurve>();
  for (const row of rows) {
    const ppByAccuracy = parsePpByAccuracy(row.ppByAccuracyJson);
    if (ppByAccuracy == null && row.ppSs == null) continue;
    out.set(row.beatmapId, { ppByAccuracy, ppSs: row.ppSs ?? null });
  }
  return out;
}
