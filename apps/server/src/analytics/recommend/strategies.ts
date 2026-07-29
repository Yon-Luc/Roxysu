
import type { Db } from "@roxysu/db/types";
import { skillForAxis, weakestAxis } from "./sevenKSkill";
import { calculateMapMatch } from "./mapMatch";
import type { CandidateRow } from "./candidates";
import { axesForFilter, pickCandidatesInRange } from "./pick";
import { axisLabel } from "./axis";
import { formatSunny } from "./summary";
import type {
  MapAxis,
  RecommendFocus,
  RecommendItem,
  SevenKSkillProfile,
  SkillAxis,
} from "./types";

function toItem(
  row: CandidateRow,
  match: ReturnType<typeof calculateMapMatch>,
  focus: RecommendFocus,
  targetSkillset: SkillAxis | null,
  reasoning: string,
): RecommendItem {
  return {
    ...match,
    focus,
    targetSkillset,
    reasoning,
    id: row.id,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficultyName,
    starRating: Number(row.starRating),
    bpm: Number(row.bpm),
    rulesetShortName: row.rulesetShortName,
    mapperUsername: row.mapperUsername,
    onlineId: row.onlineId,
    setOnlineId: row.setOnlineId,
    backgroundFileHash: row.backgroundFileHash,
    bestPp: row.bestPp,
    bestScore: row.bestScore,
    bestMisses: row.bestMisses,
    masteryLevel: row.masteryLevel,
    sunnyEstDiff: row.sunnyEstDiff,
  };
}

function collectPaired(
  pools: Array<ReturnType<typeof pickCandidatesInRange>>,
) {
  const seen = new Set<string>();
  const paired: Array<{
    row: CandidateRow;
    match: ReturnType<typeof calculateMapMatch>;
  }> = [];
  for (const pool of pools) {
    for (let i = 0; i < pool.rows.length; i++) {
      const row = pool.rows[i]!;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      paired.push({ row, match: pool.matches[i]! });
    }
  }
  return paired;
}

function labelForMatch(match: { axis: SkillAxis }): string {
  return axisLabel(match.axis === "overall" ? null : match.axis);
}

export function recommendPush(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
  axisFilter: MapAxis | null = null,
): RecommendItem[] {
  // Push baseline = average Sunny of 90–95% clears per axis (dan-style).
  // Target slightly above that clear level so suggestions sit in neighboring dans.
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio: 1.08,
      tolerance: 0.14,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      skillMode: "peak",
    }),
  );

  const paired = collectPaired(pools);

  paired.sort((a, b) => {
    if (a.match.playCount !== b.match.playCount) {
      return a.match.playCount - b.match.playCount;
    }
    return (
      Math.abs(a.match.relativeDifficulty - 1.08) -
      Math.abs(b.match.relativeDifficulty - 1.08)
    );
  });

  return paired.slice(0, count).map(({ row, match }) => {
    const diffPercent = (match.relativeDifficulty - 1) * 100;
    const dan = row.sunnyEstDiff ? ` · ${row.sunnyEstDiff}` : "";
    return toItem(
      row,
      match,
      "push",
      axisFilter,
      `Push ${labelForMatch(match)}: ${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(0)}% above your 90–95% clear level (${formatSunny(match.sunnyStar)} Sunny${dan})`,
    );
  });
}

export function recommendAccuracy(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
  axisFilter: MapAxis | null = null,
): RecommendItem[] {
  // Accuracy baseline = average Sunny of 99%+ scores per axis.
  // Suggest maps in that difficulty range to push toward / hold 99%+.
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio: 1.0,
      tolerance: 0.12,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      skillMode: "accuracy",
    }),
  );

  const paired = collectPaired(pools);

  const roomToImprove = paired
    .filter(
      (p) =>
        p.match.playCount > 0 &&
        p.match.bestAccuracy != null &&
        p.match.bestAccuracy < 0.99,
    )
    .sort((a, b) => {
      const accA = a.match.bestAccuracy ?? 0;
      const accB = b.match.bestAccuracy ?? 0;
      if (accB !== accA) return accB - accA;
      return (
        Math.abs(a.match.relativeDifficulty - 1.0) -
        Math.abs(b.match.relativeDifficulty - 1.0)
      );
    })
    .slice(0, Math.ceil(count / 2));

  const taken = new Set(roomToImprove.map((p) => p.row.id));
  const rest = paired
    .filter((p) => !taken.has(p.row.id))
    .sort(
      (a, b) =>
        Math.abs(a.match.relativeDifficulty - 1.0) -
        Math.abs(b.match.relativeDifficulty - 1.0),
    )
    .slice(0, count - roomToImprove.length);

  const items: RecommendItem[] = [];
  for (const { row, match } of [...roomToImprove, ...rest]) {
    const dan = row.sunnyEstDiff ? ` · ${row.sunnyEstDiff}` : "";
    if (match.playCount > 0 && match.bestAccuracy != null) {
      const accPct = (match.bestAccuracy * 100).toFixed(2);
      items.push(
        toItem(
          row,
          match,
          "accuracy",
          axisFilter,
          `Accuracy ${labelForMatch(match)}: target 99%+ (best ${accPct}% · ${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    } else {
      items.push(
        toItem(
          row,
          match,
          "accuracy",
          axisFilter,
          `Accuracy ${labelForMatch(match)}: in your 99%+ difficulty range (${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    }
  }
  return items.slice(0, count);
}

export function recommendConsistency(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
  axisFilter: MapAxis | null = null,
): RecommendItem[] {
  // Consistency baseline = average Sunny of 96–99% scores per axis.
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio: 1.0,
      tolerance: 0.12,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      skillMode: "consistency",
    }),
  );

  const paired = collectPaired(pools);

  // Prefer maps already played with room under 99%, then unplayed at level.
  const played = paired
    .filter(
      (p) =>
        p.match.playCount > 0 &&
        p.match.bestAccuracy != null &&
        p.match.bestAccuracy < 0.99,
    )
    .sort((a, b) => {
      const accA = a.match.bestAccuracy ?? 0;
      const accB = b.match.bestAccuracy ?? 0;
      if (accB !== accA) return accB - accA;
      return (
        Math.abs(a.match.relativeDifficulty - 1.0) -
        Math.abs(b.match.relativeDifficulty - 1.0)
      );
    })
    .slice(0, Math.ceil(count / 2));

  const playedIds = new Set(played.map((p) => p.row.id));
  const unplayed = paired
    .filter((p) => !playedIds.has(p.row.id))
    .sort(
      (a, b) =>
        Math.abs(a.match.relativeDifficulty - 1.0) -
        Math.abs(b.match.relativeDifficulty - 1.0),
    )
    .slice(0, count - played.length);

  const items: RecommendItem[] = [];
  for (const { row, match } of [...played, ...unplayed]) {
    const dan = row.sunnyEstDiff ? ` · ${row.sunnyEstDiff}` : "";
    if (match.playCount > 0 && match.bestAccuracy != null) {
      const accPct = (match.bestAccuracy * 100).toFixed(2);
      items.push(
        toItem(
          row,
          match,
          "consistency",
          axisFilter,
          `Consistency ${labelForMatch(match)}: polish toward 99%+ (best ${accPct}% · ${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    } else {
      items.push(
        toItem(
          row,
          match,
          "consistency",
          axisFilter,
          `Consistency ${labelForMatch(match)}: around your 96–99% level (${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    }
  }
  return items.slice(0, count);
}

export function recommendSkillset(
  db: Db,
  skill: SevenKSkillProfile,
  axisFilter: MapAxis | null,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
): RecommendItem[] {
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio: 1.0,
      tolerance: 0.2,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
    }),
  );

  const paired = collectPaired(pools);

  paired.sort(
    (a, b) =>
      Math.abs(a.match.relativeDifficulty - 1.0) -
      Math.abs(b.match.relativeDifficulty - 1.0),
  );

  return paired.slice(0, count).map(({ row, match }) => {
    return toItem(
      row,
      match,
      "skillset",
      axisFilter,
      `Good ${labelForMatch(match)} practice at your level (${formatSunny(match.sunnyStar)} Sunny)`,
    );
  });
}

export function recommendDeficit(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
): RecommendItem[] {
  const weak = weakestAxis(skill);
  const weakSkill = skillForAxis(skill, weak);
  const overall = skill.overall;
  const deficit = overall - weakSkill;
  const targetRatio = weakSkill > 0 ? 1.1 : 0.9;

  const { rows, matches } = pickCandidatesInRange(db, skill, {
    targetRatio,
    tolerance: 0.15,
    axis: weak,
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: count * 3,
  });

  const label = axisLabel(weak);
  return rows.slice(0, count).map((row, i) => {
    const match = matches[i]!;
    const deficitText =
      deficit > 0.05
        ? `deficit: ${deficit.toFixed(1)} Sunny below average`
        : "weaker axis";
    return toItem(
      row,
      match,
      "deficit",
      weak,
      `Practice ${label} (${deficitText})`,
    );
  });
}
