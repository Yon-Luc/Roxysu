
import type { Db } from "@roxysu/db/types";
import {
  parseQuery,
  compileQuery,
  toStructuredQuery,
} from "../../query-language";
import {
  estimateSevenKSkill,
  parseSkillKeyCount,
  parseSkillTopPlays,
  strongestAxis,
  weakestAxis,
} from "./sevenKSkill";
import { countMissingSunnyDan, countKeymodeWithSunny } from "./candidates";
import {
  recommendAccuracy,
  recommendConsistency,
  recommendDeficit,
  recommendPush,
  recommendSkillset,
} from "./strategies";
import { summaryFor } from "./summary";
import type {
  MapAxis,
  RecommendBatch,
  RecommendFocus,
  RecommendItem,
  RecommendSkillsetFilter,
  SkillAxis,
} from "./types";

const DEFAULT_COUNT = 10;

function clampCount(n: number | undefined): number {
  return Math.max(1, Math.min(20, Math.floor(n ?? DEFAULT_COUNT)));
}

export type RecommendOptions = {
  focus?: RecommendFocus | string;
  skillset?: RecommendSkillsetFilter | string | null;
  count?: number;
  excludeIds?: string[];
  q?: string;
  /** Top maps per band for skill estimate (default 30). */
  topPlays?: number;
  /** Mania key count — never mixed (default 7). */
  keyCount?: number;
};

function parseFocus(value: string | undefined): RecommendFocus {
  const v = (value ?? "push").toLowerCase();
  if (
    v === "consistency" ||
    v === "accuracy" ||
    v === "deficit" ||
    v === "skillset" ||
    v === "push"
  ) {
    return v;
  }
  return "push";
}

/** Parsed axis filter: rc/ln/fln limit the pool; both/null = no axis limit. */
type AxisFilter = MapAxis | "both" | null;

function parseSkillset(value: string | null | undefined): AxisFilter {
  const v = (value ?? "").toLowerCase();
  if (v === "rc" || v === "rice") return "rc";
  if (v === "ln") return "ln";
  if (v === "fln" || v === "full-ln" || v === "fullln") return "fln";
  if (v === "both") return "both";
  return null;
}

/** Map API skillset to a SQL axis filter (`null` = Rice + LN + FLN). */
function toAxisFilter(skillset: AxisFilter): MapAxis | null {
  if (skillset === "rc" || skillset === "ln" || skillset === "fln") {
    return skillset;
  }
  return null;
}

/**
 * Companella-style ranked recommendations for local mania maps of one keymode.
 */
export function recommendSevenK(
  db: Db,
  opts: RecommendOptions = {},
): RecommendBatch {
  const focus = parseFocus(opts.focus);
  const count = clampCount(opts.count);
  const excludeIds = (opts.excludeIds ?? []).filter(Boolean);
  const topPlays = parseSkillTopPlays(opts.topPlays);
  const keyCount = parseSkillKeyCount(opts.keyCount);
  let skillset = parseSkillset(opts.skillset);

  const missingSunny = countMissingSunnyDan(db, keyCount);
  const needsSunnyBackfill = missingSunny > 0;

  const skill = estimateSevenKSkill(db, { topPlays, keyCount });

  let overlaySql: string | null = null;
  let overlayParams: unknown[] = [];
  const overlayQ = toStructuredQuery(opts.q);
  if (overlayQ) {
    const ast = parseQuery(overlayQ);
    const compiled = compileQuery(ast);
    overlaySql = compiled.sql;
    overlayParams = compiled.params;
  }

  const overlay = { sql: overlaySql, params: overlayParams };
  const totalMapsConsidered = countKeymodeWithSunny(db, keyCount);

  // Companella defaults skillset focus to the player's strongest axis when unset.
  if (focus === "skillset" && skillset === null) {
    skillset = strongestAxis(skill);
  }

  const axisFilter = toAxisFilter(skillset);
  const resolvedSkillset: SkillAxis | null =
    focus === "deficit" ? null : axisFilter;

  if (skill.overall <= 0 || totalMapsConsidered === 0) {
    return {
      focus,
      targetSkillset: resolvedSkillset,
      skill,
      skillTopPlays: topPlays,
      summary: summaryFor(focus, resolvedSkillset, skill, 0, topPlays),
      totalMapsConsidered,
      needsSunnyBackfill,
      recommendations: [],
    };
  }

  let recommendations: RecommendItem[] = [];
  let batchSkillset: SkillAxis | null = resolvedSkillset;

  switch (focus) {
    case "consistency":
      recommendations = recommendConsistency(
        db,
        skill,
        count,
        overlay,
        excludeIds,
        axisFilter,
        keyCount,
      );
      break;
    case "accuracy":
      recommendations = recommendAccuracy(
        db,
        skill,
        count,
        overlay,
        excludeIds,
        axisFilter,
        keyCount,
      );
      break;
    case "deficit": {
      const weak = weakestAxis(skill);
      batchSkillset = weak;
      recommendations = recommendDeficit(
        db,
        skill,
        count,
        overlay,
        excludeIds,
        keyCount,
      );
      break;
    }
    case "skillset":
      batchSkillset = axisFilter;
      recommendations = recommendSkillset(
        db,
        skill,
        axisFilter,
        count,
        overlay,
        excludeIds,
        keyCount,
      );
      break;
    case "push":
    default:
      recommendations = recommendPush(
        db,
        skill,
        count,
        overlay,
        excludeIds,
        axisFilter,
        keyCount,
      );
      break;
  }

  return {
    focus,
    targetSkillset: batchSkillset,
    skill,
    skillTopPlays: topPlays,
    summary: summaryFor(focus, batchSkillset, skill, recommendations.length, topPlays),
    totalMapsConsidered,
    needsSunnyBackfill,
    recommendations,
  };
}
