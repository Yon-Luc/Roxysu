import type { Db } from "@roxysu/db/types";
import {
  reworkDanIntervalTable,
  reworkDanLabel,
  reworkDanNextTierName,
} from "@roxysu/mania-difficulty";
import {
  danVariantKey,
  resolveDanVariant,
} from "../replay/mods";
import { classifyMapAxis } from "./recommend/axis";
import {
  DEFAULT_AXIS_THRESHOLDS,
  readAxisThresholdsSync,
  type AxisThresholds,
} from "./recommend/axisThresholds";
import { readFocusSettingsSync } from "./recommend/focusSettings";
import type { MapAxis } from "./recommend/types";
import {
  bestPlayPerMap,
  DEFAULT_SKILL_KEY_COUNT,
  DEFAULT_SKILL_TOP_PLAYS,
  estimateSevenKSkillFromPlays,
  parseSkillKeyCount,
  skillBandAccRange,
  type SkillBandKind,
  type SkillPlayRow,
} from "./recommend/sevenKSkill";
import {
  resolveScoresGamemodeSync,
  scoresGamemodeSql,
} from "./scoreGamemode";
import {
  resolveScoresUsernamesSync,
  scoresUsernameSql,
} from "./scoreUsername";
import { loadDanVariantRatingsSync } from "../map-analysis/computeDanVariants";
import { REWORK_ALGORITHM } from "../map-analysis/reworkEstimator";
import { PATTERN_ALGORITHM } from "../map-analysis/computePatternAnalysis";

const DEFAULT_KEY_COUNT = DEFAULT_SKILL_KEY_COUNT;

export type SkillBandAxis = "all" | MapAxis;

export type SkillBandPlayDetail = {
  scoreId: string;
  beatmapId: string;
  title: string;
  artist: string;
  difficultyName: string;
  accuracy: number;
  reworkStar: number;
  danLabel: string;
  mods: string | null;
  playedAt: number;
};

export type SkillBandPlaysResult = {
  band: SkillBandKind;
  axis: SkillBandAxis;
  topPlays: number;
  accMin: number;
  accMax: number;
  currentLevel: number;
  currentDanLabel: string | null;
  nextDanLabel: string | null;
  inBand: SkillBandPlayDetail[];
  inBandTotal: number;
  inNextDan: SkillBandPlayDetail[];
  inNextDanTotal: number;
};

type EnrichedPlayRow = SkillPlayRow & {
  scoreId: string;
  title: string;
  artist: string;
  difficultyName: string;
  reworkEstDiff: string | null;
  mods: string | null;
  /** Primary chart shape (`mania-skill-v1`), or null/"" when unclassified. */
  shapePattern: string | null;
};

function normalizeTopPlays(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SKILL_TOP_PLAYS;
  return Math.min(500, Math.max(1, Math.round(n)));
}

function axisLnRatio(axis: SkillBandAxis): number {
  if (axis === "ln") return 0.5;
  if (axis === "fln") return 0.9;
  return 0;
}

function axisFilter(axis: SkillBandAxis): MapAxis | undefined {
  return axis === "all" ? undefined : axis;
}

function skillBandField(
  band: SkillBandKind,
): "peak" | "accuracy" | "consistency" {
  if (band === "push") return "peak";
  if (band === "accuracy") return "accuracy";
  return "consistency";
}

function bandLevelForAxis(
  skill: ReturnType<typeof estimateSevenKSkillFromPlays>,
  band: SkillBandKind,
  axis: SkillBandAxis,
): number {
  const field = skillBandField(band);
  if (axis === "all") {
    if (field === "peak") return skill.peakOverall;
    if (field === "accuracy") return skill.accuracyOverall;
    return skill.consistencyOverall;
  }
  const key =
    `${field}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as
      | "peakRc"
      | "peakLn"
      | "peakFln"
      | "accuracyRc"
      | "accuracyLn"
      | "accuracyFln"
      | "consistencyRc"
      | "consistencyLn"
      | "consistencyFln";
  return skill[key];
}

function toDetail(
  play: EnrichedPlayRow,
  lnRatioForDan: number,
  keyCount: number,
): SkillBandPlayDetail {
  const reworkStar = play.reworkStar ?? 0;
  return {
    scoreId: play.scoreId,
    beatmapId: play.beatmapId,
    title: play.title,
    artist: play.artist,
    difficultyName: play.difficultyName,
    accuracy: play.accuracy,
    reworkStar,
    danLabel:
      play.reworkEstDiff ??
      reworkDanLabel(reworkStar, play.lnRatio ?? lnRatioForDan, keyCount),
    mods: play.mods,
    playedAt: play.playedAt,
  };
}

/** Star bounds for the next rework tier above `sr`, or null at the top. */
function nextReworkDanBounds(
  sr: number,
  lnRatio: number,
  keyCount: number,
): { lower: number; upper: number; label: string } | null {
  const nextName = reworkDanNextTierName(sr, lnRatio, keyCount);
  if (!nextName) return null;
  const table = reworkDanIntervalTable(lnRatio, keyCount);
  if (!table) return null;
  const intervals = table.filter(
    ([, , label]) => label === nextName || label.startsWith(`${nextName} `),
  );
  if (intervals.length === 0) return null;
  return {
    lower: intervals[0]![0],
    upper: intervals[intervals.length - 1]![1],
    label: nextName,
  };
}

function loadEnrichedSevenKPlays(
  db: Db,
  keyCount: number,
  shape?: string,
): EnrichedPlayRow[] {
  const user = scoresUsernameSql(resolveScoresUsernamesSync(db));
  const mode = scoresGamemodeSql(resolveScoresGamemodeSync(db));
  const rows = db.$client
    .query(
      `
      SELECT
        s.id AS scoreId,
        s.beatmap_id AS beatmapId,
        COALESCE(b.title, 'Untitled') AS title,
        COALESCE(b.artist, 'Unknown') AS artist,
        COALESCE(b.difficulty_name, '') AS difficultyName,
        s.accuracy AS accuracy,
        s.played_at AS playedAt,
        s.mods AS mods,
        dr.sunny_star AS reworkStar,
        dr.ln_ratio AS lnRatio,
        dr.est_diff AS reworkEstDiff,
        pa.shape_pattern AS shapePattern
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE s.delete_pending = 0
        ${user.sql}
        ${mode.sql}
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
        AND s.beatmap_id IS NOT NULL
      ORDER BY s.played_at DESC
    `,
    )
    .all(REWORK_ALGORITHM, PATTERN_ALGORITHM, ...user.params, ...mode.params, keyCount) as Array<{
    scoreId: string;
    beatmapId: string;
    title: string;
    artist: string;
    difficultyName: string;
    accuracy: number;
    playedAt: number;
    mods: string | null;
    reworkStar: number | null;
    lnRatio: number | null;
    reworkEstDiff: string | null;
    shapePattern: string | null;
  }>;

  // Modded plays read their persisted dan difficulty variants (dropped until
  // the variant job computes them); NM plays read the base store join.
  const variantRatings = loadDanVariantRatingsSync(
    db,
    [...new Set(rows.map((r) => r.beatmapId))],
    REWORK_ALGORITHM,
  );

  const out: EnrichedPlayRow[] = [];
  for (const r of rows) {
    const variant = resolveDanVariant(r.mods);
    let reworkStar = r.reworkStar != null ? Number(r.reworkStar) : null;
    let lnRatio = r.lnRatio != null ? Number(r.lnRatio) : null;
    let reworkEstDiff = r.reworkEstDiff;
    if (variant) {
      const stored = variantRatings.get(danVariantKey(r.beatmapId, variant));
      if (!stored) continue;
      reworkStar = stored.star;
      lnRatio = stored.lnRatio;
      reworkEstDiff = stored.estDiff;
    }
    // A shape-filtered list follows the NM chart's shape: full-LN Invert
    // rebuilds the chart, so those plays cannot claim the base chart's shape.
    if (shape && (variant?.lnOnly || r.shapePattern !== shape)) continue;
    out.push({
      scoreId: r.scoreId,
      beatmapId: r.beatmapId,
      title: r.title,
      artist: r.artist,
      difficultyName: r.difficultyName,
      accuracy: Number(r.accuracy ?? 0),
      playedAt: Number(r.playedAt ?? 0),
      reworkStar,
      lnRatio,
      reworkEstDiff,
      mods: r.mods,
      shapePattern: r.shapePattern ?? null,
    });
  }
  return out;
}

function playsInDanInterval(
  plays: EnrichedPlayRow[],
  accFloor: number,
  axis: SkillBandAxis,
  lower: number,
  upper: number,
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
): EnrichedPlayRow[] {
  const mapAxis = axisFilter(axis);
  return bestPlayPerMap(
    plays.filter((p) => {
      if (p.reworkStar == null || !(p.reworkStar > 0)) return false;
      if (p.accuracy < accFloor) return false;
      if (
        mapAxis != null &&
        classifyMapAxis(p.lnRatio, thresholds) !== mapAxis
      )
        return false;
      return p.reworkStar >= lower && p.reworkStar <= upper;
    }),
  ).sort(
    (a, b) =>
      b.reworkStar! - a.reworkStar! ||
      b.accuracy - a.accuracy ||
      b.playedAt - a.playedAt ||
      a.beatmapId.localeCompare(b.beatmapId),
  );
}

function topEnrichedPlaysInBand(
  plays: EnrichedPlayRow[],
  accFloor: number,
  topN: number,
  axis?: MapAxis,
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
  accCeil?: number | null,
): EnrichedPlayRow[] {
  return bestPlayPerMap(
    plays.filter(
      (p) =>
        p.reworkStar != null &&
        p.reworkStar > 0 &&
        p.accuracy >= accFloor &&
        (accCeil == null || p.accuracy < accCeil) &&
        (axis == null || classifyMapAxis(p.lnRatio, thresholds) === axis),
    ),
  )
    .sort(
      (a, b) =>
        b.reworkStar! - a.reworkStar! ||
        b.accuracy - a.accuracy ||
        b.playedAt - a.playedAt ||
        a.beatmapId.localeCompare(b.beatmapId),
    )
    .slice(0, topN);
}

export function getSkillBandPlays(
  db: Db,
  opts: {
    band: SkillBandKind;
    axis?: SkillBandAxis;
    topPlays?: number;
    keyCount?: number;
    /** Restrict the play lists to one primary chart shape; currentLevel stays whole. */
    shape?: string;
  },
): SkillBandPlaysResult {
  const band = opts.band;
  const axis: SkillBandAxis = opts.axis ?? "all";
  const shape = opts.shape?.trim() || undefined;
  const focus = readFocusSettingsSync(db);
  const topN = normalizeTopPlays(opts.topPlays ?? focus.topPlays);
  const keyCount = parseSkillKeyCount(opts.keyCount ?? DEFAULT_KEY_COUNT);
  const { min: accMin, max: accMax } = skillBandAccRange(band, focus);
  const lnRatioForDan = axisLnRatio(axis);
  const thresholds = readAxisThresholdsSync(db);

  // Cached rework ratings only — no request-path backfill.
  const plays = loadEnrichedSevenKPlays(db, keyCount);
  // Shape-scoped lists need a second pass; the current level stays whole-mode.
  const shapePlays = shape ? loadEnrichedSevenKPlays(db, keyCount, shape) : plays;

  const skillRows: SkillPlayRow[] = plays.map((p) => ({
    beatmapId: p.beatmapId,
    accuracy: p.accuracy,
    playedAt: p.playedAt,
    reworkStar: p.reworkStar,
    lnRatio: p.lnRatio,
  }));

  const skill = estimateSevenKSkillFromPlays(skillRows, {
    topPlays: topN,
    axisThresholds: thresholds,
    focusSettings: focus,
  });
  const currentLevel = bandLevelForAxis(skill, band, axis);

  const inBandEnriched = topEnrichedPlaysInBand(
    shapePlays,
    accMin,
    topN,
    axisFilter(axis),
    thresholds,
    accMax,
  );

  const currentDanLabel =
    currentLevel > 0
      ? reworkDanLabel(currentLevel, lnRatioForDan, keyCount)
      : null;
  const nextBounds =
    currentLevel > 0
      ? nextReworkDanBounds(currentLevel, lnRatioForDan, keyCount)
      : null;

  let inNextDanEnriched: EnrichedPlayRow[] = [];
  if (nextBounds) {
    inNextDanEnriched = playsInDanInterval(
      shapePlays,
      accMin,
      axis,
      nextBounds.lower,
      nextBounds.upper,
      thresholds,
    );
  }

  return {
    band,
    axis,
    topPlays: topN,
    accMin,
    accMax,
    currentLevel,
    currentDanLabel,
    nextDanLabel: nextBounds?.label ?? null,
    inBand: inBandEnriched.map((p) => toDetail(p, lnRatioForDan, keyCount)),
    inBandTotal: inBandEnriched.length,
    inNextDan: inNextDanEnriched
      .slice(0, topN)
      .map((p) => toDetail(p, lnRatioForDan, keyCount)),
    inNextDanTotal: inNextDanEnriched.length,
  };
}

export type { SkillBandKind };
