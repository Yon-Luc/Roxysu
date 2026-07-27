import type { Db } from "@roxysu/db/client.bun";
import { estDiff, nextDanInterval } from "@roxysu/sunny-dan";
import {
  backfillSunnyDanSync,
  ensureSunnyDanForIdsSync,
} from "../map-analysis/computeSunnyDan";
import { classifyMapAxis } from "./recommend/axis";
import type { MapAxis } from "./recommend/types";
import {
  bestPlayPerMap,
  DEFAULT_SKILL_TOP_PLAYS,
  estimateSevenKSkillFromPlays,
  skillBandAccRange,
  type SkillBandKind,
  type SkillPlayRow,
} from "./recommend/sevenKSkill";

const SKILL_KEY_COUNT = 7;

export type SkillBandAxis = "all" | MapAxis;

export type SkillBandPlayDetail = {
  scoreId: string;
  beatmapId: string;
  title: string;
  artist: string;
  difficultyName: string;
  accuracy: number;
  sunnyStar: number;
  danLabel: string;
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
  sunnyEstDiff: string | null;
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
): SkillBandPlayDetail {
  const sunnyStar = play.sunnyStar ?? 0;
  return {
    scoreId: play.scoreId,
    beatmapId: play.beatmapId,
    title: play.title,
    artist: play.artist,
    difficultyName: play.difficultyName,
    accuracy: play.accuracy,
    sunnyStar,
    danLabel:
      play.sunnyEstDiff ??
      estDiff(sunnyStar, play.lnRatio ?? lnRatioForDan, SKILL_KEY_COUNT),
    playedAt: play.playedAt,
  };
}

function loadEnrichedSevenKPlays(db: Db): EnrichedPlayRow[] {
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
        dr.sunny_star AS sunnyStar,
        dr.ln_ratio AS lnRatio,
        dr.est_diff AS sunnyEstDiff
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
        AND s.beatmap_id IS NOT NULL
      ORDER BY s.played_at DESC
    `,
    )
    .all() as Array<{
    scoreId: string;
    beatmapId: string;
    title: string;
    artist: string;
    difficultyName: string;
    accuracy: number;
    playedAt: number;
    sunnyStar: number | null;
    lnRatio: number | null;
    sunnyEstDiff: string | null;
  }>;

  return rows.map((r) => ({
    scoreId: r.scoreId,
    beatmapId: r.beatmapId,
    title: r.title,
    artist: r.artist,
    difficultyName: r.difficultyName,
    accuracy: Number(r.accuracy ?? 0),
    playedAt: Number(r.playedAt ?? 0),
    sunnyStar: r.sunnyStar != null ? Number(r.sunnyStar) : null,
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
    sunnyEstDiff: r.sunnyEstDiff,
  }));
}

function ensureSunnyForEnrichedPlays(
  db: Db,
  plays: EnrichedPlayRow[],
): EnrichedPlayRow[] {
  const missingIds = [
    ...new Set(
      plays.filter((p) => p.sunnyStar == null).map((p) => p.beatmapId),
    ),
  ];
  if (missingIds.length === 0) return plays;
  ensureSunnyDanForIdsSync(db, missingIds);
  return loadEnrichedSevenKPlays(db);
}

function playsInDanInterval(
  plays: EnrichedPlayRow[],
  accFloor: number,
  axis: SkillBandAxis,
  lower: number,
  upper: number,
): EnrichedPlayRow[] {
  const mapAxis = axisFilter(axis);
  return bestPlayPerMap(
    plays.filter((p) => {
      if (p.sunnyStar == null || !(p.sunnyStar > 0)) return false;
      if (p.accuracy < accFloor) return false;
      if (mapAxis != null && classifyMapAxis(p.lnRatio) !== mapAxis) return false;
      return p.sunnyStar >= lower && p.sunnyStar <= upper;
    }),
  ).sort(
    (a, b) =>
      b.sunnyStar! - a.sunnyStar! ||
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
): EnrichedPlayRow[] {
  return bestPlayPerMap(
    plays.filter(
      (p) =>
        p.sunnyStar != null &&
        p.sunnyStar > 0 &&
        p.accuracy >= accFloor &&
        (axis == null || classifyMapAxis(p.lnRatio) === axis),
    ),
  )
    .sort(
      (a, b) =>
        b.sunnyStar! - a.sunnyStar! ||
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
  },
): SkillBandPlaysResult {
  const band = opts.band;
  const axis: SkillBandAxis = opts.axis ?? "all";
  const topN = normalizeTopPlays(opts.topPlays);
  const { min: accMin, max: accMax } = skillBandAccRange(band);
  const lnRatioForDan = axisLnRatio(axis);

  backfillSunnyDanSync(db, { limit: 120 });
  let plays = loadEnrichedSevenKPlays(db);
  plays = ensureSunnyForEnrichedPlays(db, plays);

  const skillRows: SkillPlayRow[] = plays.map((p) => ({
    beatmapId: p.beatmapId,
    accuracy: p.accuracy,
    playedAt: p.playedAt,
    sunnyStar: p.sunnyStar,
    lnRatio: p.lnRatio,
  }));

  const skill = estimateSevenKSkillFromPlays(skillRows, { topPlays: topN });
  const currentLevel = bandLevelForAxis(skill, band, axis);

  const inBandEnriched = topEnrichedPlaysInBand(
    plays,
    accMin,
    topN,
    axisFilter(axis),
  );

  const currentDanLabel =
    currentLevel > 0
      ? estDiff(currentLevel, lnRatioForDan, SKILL_KEY_COUNT)
      : null;
  const nextInterval =
    currentLevel > 0
      ? nextDanInterval(currentLevel, lnRatioForDan, SKILL_KEY_COUNT)
      : null;

  let inNextDanEnriched: EnrichedPlayRow[] = [];
  if (nextInterval) {
    const [lower, upper] = nextInterval;
    inNextDanEnriched = playsInDanInterval(
      plays,
      accMin,
      axis,
      lower,
      upper,
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
    nextDanLabel: nextInterval?.[2] ?? null,
    inBand: inBandEnriched.map((p) => toDetail(p, lnRatioForDan)),
    inBandTotal: inBandEnriched.length,
    inNextDan: inNextDanEnriched
      .slice(0, topN)
      .map((p) => toDetail(p, lnRatioForDan)),
    inNextDanTotal: inNextDanEnriched.length,
  };
}

export type { SkillBandKind };
