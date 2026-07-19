import type { Db } from "@roxysu/db/client.bun";
import {
  parseQuery,
  compileQuery,
  toStructuredQuery,
} from "../../query-language";
import { backfillSunnyDanSync } from "../../map-analysis/computeSunnyDan";
import { estimateSevenKSkill, weakestAxis } from "./sevenKSkill";
import { countMissingSunnyDan, countSevenKWithSunny } from "./candidates";
import {
  recommendConsistency,
  recommendDeficit,
  recommendPush,
  recommendSkillset,
} from "./strategies";
import { summaryFor } from "./summary";
import type {
  RecommendBatch,
  RecommendFocus,
  RecommendItem,
  RecommendSkillsetFilter,
  SkillAxis,
} from "./types";

const DEFAULT_COUNT = 10;
const DAN_BACKFILL_LIMIT = 120;

function clampCount(n: number | undefined): number {
  return Math.max(1, Math.min(20, Math.floor(n ?? DEFAULT_COUNT)));
}

export type RecommendOptions = {
  focus?: RecommendFocus | string;
  skillset?: RecommendSkillsetFilter | string | null;
  count?: number;
  excludeIds?: string[];
  q?: string;
};

function parseFocus(value: string | undefined): RecommendFocus {
  const v = (value ?? "push").toLowerCase();
  if (v === "consistency" || v === "deficit" || v === "skillset" || v === "push") {
    return v;
  }
  return "push";
}

/** Parsed axis filter: rc/ln limit the pool; both/null = no axis limit. */
type AxisFilter = "rc" | "ln" | "both" | null;

function parseSkillset(value: string | null | undefined): AxisFilter {
  const v = (value ?? "").toLowerCase();
  if (v === "rc" || v === "rice") return "rc";
  if (v === "ln") return "ln";
  if (v === "both") return "both";
  return null;
}

/** Map API skillset to a SQL axis filter (`null` = Rice + LN). */
function toAxisFilter(skillset: AxisFilter): "rc" | "ln" | null {
  if (skillset === "rc" || skillset === "ln") return skillset;
  return null;
}

/**
 * Companella-style ranked recommendations for local 7K mania maps.
 */
export function recommendSevenK(
  db: Db,
  opts: RecommendOptions = {},
): RecommendBatch {
  const focus = parseFocus(opts.focus);
  const count = clampCount(opts.count);
  const excludeIds = (opts.excludeIds ?? []).filter(Boolean);
  let skillset = parseSkillset(opts.skillset);

  // Ensure a pool of Sunny ratings exists before searching.
  backfillSunnyDanSync(db, { limit: DAN_BACKFILL_LIMIT });
  const missingSunny = countMissingSunnyDan(db);
  const needsSunnyBackfill = missingSunny > 0;

  const skill = estimateSevenKSkill(db);

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
  const totalMapsConsidered = countSevenKWithSunny(db);

  // Companella defaults skillset focus to the player's strongest axis when unset.
  if (focus === "skillset" && skillset === null) {
    skillset = skill.rc >= skill.ln ? "rc" : "ln";
  }

  const axisFilter = toAxisFilter(skillset);
  const resolvedSkillset: SkillAxis | null =
    focus === "deficit" ? null : axisFilter;

  if (skill.overall <= 0 || totalMapsConsidered === 0) {
    return {
      focus,
      targetSkillset: resolvedSkillset,
      skill,
      summary: summaryFor(focus, resolvedSkillset, skill, 0),
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
      );
      break;
  }

  return {
    focus,
    targetSkillset: batchSkillset,
    skill,
    summary: summaryFor(focus, batchSkillset, skill, recommendations.length),
    totalMapsConsidered,
    needsSunnyBackfill,
    recommendations,
  };
}
