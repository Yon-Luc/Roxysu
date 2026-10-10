
import type { Db } from "@roxysu/db/types";
import { skillForAxis, weakestAxis } from "./sevenKSkill";
import { calculateMapMatch } from "./mapMatch";
import type { CandidateRow } from "./candidates";
import { axesForFilter, pickCandidatesInRange } from "./pick";
import { axisLabel } from "./axis";
import {
  DEFAULT_AXIS_THRESHOLDS,
  type AxisThresholds,
} from "./axisThresholds";
import {
  DEFAULT_FOCUS_SETTINGS,
  formatAccBandLabel,
  type RecommendFocusSettings,
} from "./focusSettings";
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
    keyCount: row.keyCount,
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
  keyCount: number,
  axisThresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
  focusSettings: RecommendFocusSettings = DEFAULT_FOCUS_SETTINGS,
): RecommendItem[] {
  const { targetRatio, tolerance } = focusSettings.push;
  const bandLabel = formatAccBandLabel(focusSettings.push);
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio,
      tolerance,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      keyCount,
      skillMode: "peak",
      axisThresholds,
    }),
  );

  const paired = collectPaired(pools);

  paired.sort((a, b) => {
    if (a.match.playCount !== b.match.playCount) {
      return a.match.playCount - b.match.playCount;
    }
    return (
      Math.abs(a.match.relativeDifficulty - targetRatio) -
      Math.abs(b.match.relativeDifficulty - targetRatio)
    );
  });

  return paired.slice(0, count).map(({ row, match }) => {
    const diffPercent = (match.relativeDifficulty - 1) * 100;
    const dan = row.sunnyEstDiff ? ` · ${row.sunnyEstDiff}` : "";
    const diffText =
      Math.abs(diffPercent) < 0.5
        ? "at"
        : `${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(0)}% vs`;
    return toItem(
      row,
      match,
      "push",
      axisFilter,
      `Push ${labelForMatch(match)}: ${diffText} your ${bandLabel} clear level (${formatSunny(match.sunnyStar)} Sunny${dan})`,
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
  keyCount: number,
  axisThresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
  focusSettings: RecommendFocusSettings = DEFAULT_FOCUS_SETTINGS,
): RecommendItem[] {
  const { targetRatio, tolerance, accMin } = focusSettings.accuracy;
  const bandLabel = formatAccBandLabel(focusSettings.accuracy);
  const polishFloor = Math.min(accMin, 0.99);
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio,
      tolerance,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      keyCount,
      skillMode: "accuracy",
      axisThresholds,
    }),
  );

  const paired = collectPaired(pools);

  const roomToImprove = paired
    .filter(
      (p) =>
        p.match.playCount > 0 &&
        p.match.bestAccuracy != null &&
        p.match.bestAccuracy < polishFloor,
    )
    .sort((a, b) => {
      const accA = a.match.bestAccuracy ?? 0;
      const accB = b.match.bestAccuracy ?? 0;
      if (accB !== accA) return accB - accA;
      return (
        Math.abs(a.match.relativeDifficulty - targetRatio) -
        Math.abs(b.match.relativeDifficulty - targetRatio)
      );
    })
    .slice(0, Math.ceil(count / 2));

  const taken = new Set(roomToImprove.map((p) => p.row.id));
  const rest = paired
    .filter((p) => !taken.has(p.row.id))
    .sort(
      (a, b) =>
        Math.abs(a.match.relativeDifficulty - targetRatio) -
        Math.abs(b.match.relativeDifficulty - targetRatio),
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
          `Accuracy ${labelForMatch(match)}: target ${bandLabel} (best ${accPct}% · ${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    } else {
      items.push(
        toItem(
          row,
          match,
          "accuracy",
          axisFilter,
          `Accuracy ${labelForMatch(match)}: in your ${bandLabel} difficulty range (${formatSunny(match.sunnyStar)} Sunny${dan})`,
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
  keyCount: number,
  axisThresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
  focusSettings: RecommendFocusSettings = DEFAULT_FOCUS_SETTINGS,
): RecommendItem[] {
  const { targetRatio, tolerance } = focusSettings.consistency;
  const bandLabel = formatAccBandLabel(focusSettings.consistency);
  const polishCeil = focusSettings.accuracy.accMin;
  const axes = axesForFilter(axisFilter);
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const pools = axes.map((axis) =>
    pickCandidatesInRange(db, skill, {
      targetRatio,
      tolerance,
      axis,
      overlaySql: overlay.sql,
      overlayParams: overlay.params,
      excludeIds,
      pool: perAxis * 3,
      keyCount,
      skillMode: "consistency",
      axisThresholds,
    }),
  );

  const paired = collectPaired(pools);

  const played = paired
    .filter(
      (p) =>
        p.match.playCount > 0 &&
        p.match.bestAccuracy != null &&
        p.match.bestAccuracy < polishCeil,
    )
    .sort((a, b) => {
      const accA = a.match.bestAccuracy ?? 0;
      const accB = b.match.bestAccuracy ?? 0;
      if (accB !== accA) return accB - accA;
      return (
        Math.abs(a.match.relativeDifficulty - targetRatio) -
        Math.abs(b.match.relativeDifficulty - targetRatio)
      );
    })
    .slice(0, Math.ceil(count / 2));

  const playedIds = new Set(played.map((p) => p.row.id));
  const unplayed = paired
    .filter((p) => !playedIds.has(p.row.id))
    .sort(
      (a, b) =>
        Math.abs(a.match.relativeDifficulty - targetRatio) -
        Math.abs(b.match.relativeDifficulty - targetRatio),
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
          `Consistency ${labelForMatch(match)}: polish toward ${formatAccBandLabel(focusSettings.accuracy)} (best ${accPct}% · ${formatSunny(match.sunnyStar)} Sunny${dan})`,
        ),
      );
    } else {
      items.push(
        toItem(
          row,
          match,
          "consistency",
          axisFilter,
          `Consistency ${labelForMatch(match)}: around your ${bandLabel} level (${formatSunny(match.sunnyStar)} Sunny${dan})`,
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
  keyCount: number,
  axisThresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
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
      keyCount,
      axisThresholds,
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
  keyCount: number,
  axisThresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
  focusSettings: RecommendFocusSettings = DEFAULT_FOCUS_SETTINGS,
): RecommendItem[] {
  const weak = weakestAxis(skill);
  const weakSkill = skillForAxis(skill, weak);
  const overall = skill.overall;
  const deficit = overall - weakSkill;
  const { targetRatio, tolerance } = focusSettings.deficit;
  const effectiveRatio = weakSkill > 0 ? targetRatio : Math.min(targetRatio, 0.9);

  const { rows, matches } = pickCandidatesInRange(db, skill, {
    targetRatio: effectiveRatio,
    tolerance,
    axis: weak,
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: count * 3,
    keyCount,
    axisThresholds,
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
