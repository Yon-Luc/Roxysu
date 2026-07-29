
import type { Db } from "@roxysu/db/types";
import { ensureSunnyDanForIdsSync } from "../../map-analysis/computeSunnyDan";
import { skillForAxis } from "./sevenKSkill";
import { calculateMapMatch, mapMatchesAxis } from "./mapMatch";
import {
  buildBaseSevenKFilter,
  loadCandidates,
  type CandidateRow,
} from "./candidates";
import type { SevenKSkillProfile, SkillAxis } from "./types";

export function pickCandidatesInRange(
  db: Db,
  skill: SevenKSkillProfile,
  opts: {
    targetRatio: number;
    tolerance: number;
    axis: "rc" | "ln" | "fln" | null;
    overlaySql: string | null;
    overlayParams: unknown[];
    excludeIds: string[];
    pool: number;
    skillMode?: "comfort" | "peak" | "consistency" | "accuracy";
  },
): { rows: CandidateRow[]; matches: ReturnType<typeof calculateMapMatch>[] } {
  const skillMode = opts.skillMode ?? "comfort";
  const playerSkill = skillForAxis(
    skill,
    opts.axis ?? "overall",
    skillMode,
  );
  if (playerSkill <= 0) return { rows: [], matches: [] };

  const targetSunny = playerSkill * opts.targetRatio;
  const minSunny = Math.max(0, targetSunny * (1 - opts.tolerance));
  const maxSunny = targetSunny * (1 + opts.tolerance);

  const filter = buildBaseSevenKFilter(
    minSunny,
    maxSunny,
    opts.axis,
    opts.overlaySql,
    opts.overlayParams,
  );

  let rows = loadCandidates(
    db,
    filter.sql,
    filter.params,
    opts.excludeIds,
    opts.pool,
  );

  const missing = rows
    .filter((r) => r.sunnyStar == null)
    .map((r) => r.id);
  if (missing.length > 0) {
    ensureSunnyDanForIdsSync(db, missing);
    rows = loadCandidates(
      db,
      filter.sql,
      filter.params,
      opts.excludeIds,
      opts.pool,
    );
  }

  const minRatio = opts.targetRatio - opts.tolerance;
  const maxRatio = opts.targetRatio + opts.tolerance;
  const targetSkillset: SkillAxis | null = opts.axis;

  const paired: Array<{
    row: CandidateRow;
    match: ReturnType<typeof calculateMapMatch>;
  }> = [];

  for (const row of rows) {
    if (row.sunnyStar == null || row.sunnyStar <= 0) continue;
    if (opts.axis && !mapMatchesAxis(row.lnRatio, opts.axis)) continue;

    const match = calculateMapMatch(
      {
        id: row.id,
        sunnyStar: row.sunnyStar,
        lnRatio: row.lnRatio,
        bestAccuracy: row.bestAccuracy,
        playCount: row.playCount,
        lastPlayedAt: row.lastPlayedAt,
      },
      skill,
      targetSkillset,
      skillMode,
    );

    if (
      match.relativeDifficulty >= minRatio &&
      match.relativeDifficulty <= maxRatio
    ) {
      paired.push({ row, match });
    }
  }

  paired.sort(
    (a, b) =>
      Math.abs(a.match.relativeDifficulty - opts.targetRatio) -
      Math.abs(b.match.relativeDifficulty - opts.targetRatio),
  );

  return {
    rows: paired.map((p) => p.row),
    matches: paired.map((p) => p.match),
  };
}

export function axesForFilter(
  axisFilter: "rc" | "ln" | "fln" | null,
): Array<"rc" | "ln" | "fln"> {
  return axisFilter ? [axisFilter] : ["rc", "ln", "fln"];
}
