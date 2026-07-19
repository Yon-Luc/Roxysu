import type { Db } from "@roxysu/db/client.bun";
import { looksLikeQuery, parseQuery, compileQuery } from "../../query-language";
import {
  backfillSunnyDanSync,
  ensureSunnyDanForIdsSync,
  SUNNY_ALGORITHM,
} from "../../map-analysis/computeSunnyDan";
import { LN_DAN_RATIO_THRESHOLD } from "../../map-analysis/estDiff";
import {
  estimateSevenKSkill,
  skillForAxis,
  weakestAxis,
} from "./sevenKSkill";
import { calculateMapMatch, mapMatchesAxis } from "./mapMatch";
import type {
  RecommendBatch,
  RecommendFocus,
  RecommendItem,
  SkillAxis,
  SevenKSkillProfile,
} from "./types";

const DEFAULT_COUNT = 10;
const DAN_BACKFILL_LIMIT = 120;

function countMissingSunnyDan(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          dr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(SUNNY_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

type CandidateRow = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  onlineId: number | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  bestScore: number | null;
  bestMisses: number | null;
  lastPlayedAt: number | null;
  masteryLevel: number | null;
  sunnyEstDiff: string | null;
  sunnyStar: number | null;
  lnRatio: number | null;
};

function toStructuredOverlay(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  if (!trimmed) return undefined;
  if (looksLikeQuery(trimmed)) return trimmed;
  return `title:${trimmed} OR artist:${trimmed} OR mapper:${trimmed} OR diff:${trimmed}`;
}

function clampCount(n: number | undefined): number {
  return Math.max(1, Math.min(20, Math.floor(n ?? DEFAULT_COUNT)));
}

function formatSunny(n: number): string {
  return n.toFixed(1);
}

function buildBaseSevenKFilter(
  minSunny: number,
  maxSunny: number,
  axis: "rc" | "ln" | null,
  overlaySql: string | null,
  overlayParams: unknown[],
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (v: unknown) => {
    params.push(v);
    return `?`;
  };

  const parts = [
    `LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'`,
    `b.circle_size = 7`,
    `dr.sunny_star IS NOT NULL`,
    `dr.sunny_star BETWEEN ${push(minSunny)} AND ${push(maxSunny)}`,
  ];

  if (axis === "ln") {
    parts.push(`COALESCE(dr.ln_ratio, 0) >= ${push(LN_DAN_RATIO_THRESHOLD)}`);
  } else if (axis === "rc") {
    parts.push(`COALESCE(dr.ln_ratio, 0) < ${push(LN_DAN_RATIO_THRESHOLD)}`);
  }

  if (overlaySql) {
    parts.push(`(${overlaySql})`);
    params.push(...overlayParams);
  }

  return { sql: parts.join(" AND "), params };
}

function loadCandidates(
  db: Db,
  filterSql: string,
  filterParams: unknown[],
  excludeIds: string[],
  limit: number,
): CandidateRow[] {
  const params = [...filterParams];
  let excludeSql = "";
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => "?").join(",");
    excludeSql = ` AND b.id NOT IN (${placeholders})`;
    params.push(...excludeIds);
  }

  const sql = `
    SELECT
      b.id AS id,
      b.title AS title,
      b.artist AS artist,
      b.difficulty_name AS difficultyName,
      b.star_rating AS starRating,
      b.bpm AS bpm,
      b.ruleset_short_name AS rulesetShortName,
      b.mapper_username AS mapperUsername,
      CASE WHEN b.online_id > 0 THEN b.online_id ELSE NULL END AS onlineId,
      CASE WHEN bs.online_id > 0 THEN bs.online_id ELSE NULL END AS setOnlineId,
      b.background_file_hash AS backgroundFileHash,
      COALESCE(ps.play_count, 0) AS playCount,
      ps.best_accuracy AS bestAccuracy,
      ps.best_pp AS bestPp,
      ps.best_score AS bestScore,
      ps.best_misses AS bestMisses,
      ps.last_played_at AS lastPlayedAt,
      m.level AS masteryLevel,
      dr.est_diff AS sunnyEstDiff,
      dr.sunny_star AS sunnyStar,
      dr.ln_ratio AS lnRatio
    FROM beatmaps b
    LEFT JOIN mastery m ON m.beatmap_id = b.id
    LEFT JOIN (
      SELECT
        beatmap_id,
        COUNT(*) AS play_count,
        MAX(accuracy) AS best_accuracy,
        MAX(pp) AS best_pp,
        MAX(total_score) AS best_score,
        MIN(
          CASE
            WHEN statistics IS NOT NULL
            THEN COALESCE(json_extract(statistics, '$.miss'), 0)
          END
        ) AS best_misses,
        MAX(played_at) AS last_played_at
      FROM scores
      WHERE delete_pending = 0 AND beatmap_id IS NOT NULL
      GROUP BY beatmap_id
    ) ps ON ps.beatmap_id = b.id
    LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
    LEFT JOIN beatmap_dan_ratings dr
      ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
    WHERE b.hidden = 0
      AND COALESCE(bs.delete_pending, 0) = 0
      AND (${filterSql})
      ${excludeSql}
    ORDER BY RANDOM()
    LIMIT ?
  `;

  const rows = db.$client
    .query(sql)
    .all(...(params as Array<string | number | bigint | boolean | null>), limit) as CandidateRow[];

  return rows.map((r) => ({
    ...r,
    onlineId: r.onlineId != null ? Number(r.onlineId) : null,
    setOnlineId: r.setOnlineId != null ? Number(r.setOnlineId) : null,
    playCount: Number(r.playCount ?? 0),
    bestAccuracy: r.bestAccuracy != null ? Number(r.bestAccuracy) : null,
    bestPp: r.bestPp != null ? Number(r.bestPp) : null,
    bestScore: r.bestScore != null ? Number(r.bestScore) : null,
    bestMisses: r.bestMisses != null ? Number(r.bestMisses) : null,
    lastPlayedAt: r.lastPlayedAt != null ? Number(r.lastPlayedAt) : null,
    masteryLevel: r.masteryLevel != null ? Number(r.masteryLevel) : null,
    sunnyStar: r.sunnyStar != null ? Number(r.sunnyStar) : null,
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
  }));
}

function countSevenKWithSunny(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      WHERE b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
        AND dr.sunny_star IS NOT NULL
    `,
    )
    .get() as { n: number } | null;
  return Number(row?.n ?? 0);
}

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

function pickCandidatesInRange(
  db: Db,
  skill: SevenKSkillProfile,
  opts: {
    targetRatio: number;
    tolerance: number;
    axis: "rc" | "ln" | null;
    overlaySql: string | null;
    overlayParams: unknown[];
    excludeIds: string[];
    pool: number;
    skillMode?: "comfort" | "peak";
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

function recommendPush(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
): RecommendItem[] {
  // Push baseline = average Sunny of 90–95% clears per axis (dan-style).
  // Target slightly above that clear level so suggestions sit in neighboring dans.
  const perAxis = Math.max(count, Math.ceil(count * 1.5));
  const rc = pickCandidatesInRange(db, skill, {
    targetRatio: 1.08,
    tolerance: 0.14,
    axis: "rc",
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: perAxis * 3,
    skillMode: "peak",
  });
  const ln = pickCandidatesInRange(db, skill, {
    targetRatio: 1.08,
    tolerance: 0.14,
    axis: "ln",
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: perAxis * 3,
    skillMode: "peak",
  });

  const seen = new Set<string>();
  const paired: Array<{
    row: CandidateRow;
    match: ReturnType<typeof calculateMapMatch>;
  }> = [];
  for (const [rows, matches] of [
    [rc.rows, rc.matches] as const,
    [ln.rows, ln.matches] as const,
  ]) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      paired.push({ row, match: matches[i]! });
    }
  }

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
    const axisLabel = match.axis === "ln" ? "LN" : "RC";
    const dan = row.sunnyEstDiff ? ` · ${row.sunnyEstDiff}` : "";
    return toItem(
      row,
      match,
      "push",
      null,
      `Push ${axisLabel}: ${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(0)}% above your 90–95% clear level (${formatSunny(match.sunnyStar)} Sunny${dan})`,
    );
  });
}

function recommendConsistency(
  db: Db,
  skill: SevenKSkillProfile,
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
): RecommendItem[] {
  const { rows, matches } = pickCandidatesInRange(db, skill, {
    targetRatio: 0.9,
    tolerance: 0.15,
    axis: null,
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: count * 5,
  });

  const paired = rows.map((row, i) => ({ row, match: matches[i]! }));

  const played = paired
    .filter(
      (p) =>
        p.match.playCount > 0 &&
        p.match.bestAccuracy != null &&
        p.match.bestAccuracy < 0.98,
    )
    .sort((a, b) => {
      const accA = a.match.bestAccuracy ?? 0;
      const accB = b.match.bestAccuracy ?? 0;
      if (accB !== accA) return accB - accA;
      return a.match.relativeDifficulty - b.match.relativeDifficulty;
    })
    .slice(0, Math.ceil(count / 2));

  const playedIds = new Set(played.map((p) => p.row.id));
  const unplayed = paired
    .filter((p) => p.match.playCount === 0 && !playedIds.has(p.row.id))
    .sort(
      (a, b) =>
        Math.abs(a.match.relativeDifficulty - 0.9) -
        Math.abs(b.match.relativeDifficulty - 0.9),
    )
    .slice(0, count - played.length);

  const items: RecommendItem[] = [];
  for (const { row, match } of played) {
    const accPct = ((match.bestAccuracy ?? 0) * 100).toFixed(2);
    items.push(
      toItem(
        row,
        match,
        "consistency",
        null,
        `Room for improvement (best: ${accPct}% on ${formatSunny(match.sunnyStar)} Sunny)`,
      ),
    );
  }
  for (const { row, match } of unplayed) {
    items.push(
      toItem(
        row,
        match,
        "consistency",
        null,
        `Comfortable difficulty for acc practice (${formatSunny(match.sunnyStar)} Sunny)`,
      ),
    );
  }
  return items.slice(0, count);
}

function recommendSkillset(
  db: Db,
  skill: SevenKSkillProfile,
  axis: "rc" | "ln",
  count: number,
  overlay: { sql: string | null; params: unknown[] },
  excludeIds: string[],
): RecommendItem[] {
  const { rows, matches } = pickCandidatesInRange(db, skill, {
    targetRatio: 1.0,
    tolerance: 0.2,
    axis,
    overlaySql: overlay.sql,
    overlayParams: overlay.params,
    excludeIds,
    pool: count * 3,
  });

  const label = axis.toUpperCase();
  return rows.slice(0, count).map((row, i) => {
    const match = matches[i]!;
    return toItem(
      row,
      match,
      "skillset",
      axis,
      `Good ${label} practice at your level (${formatSunny(match.sunnyStar)} Sunny)`,
    );
  });
}

function recommendDeficit(
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

  const label = weak.toUpperCase();
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

function summaryFor(
  focus: RecommendFocus,
  skillset: SkillAxis | null,
  skill: SevenKSkillProfile,
  count: number,
): string {
  const focusLabel =
    focus === "skillset" && skillset
      ? `${skillset.toUpperCase()} practice`
      : focus === "consistency"
        ? "consistency/accuracy improvement"
        : focus === "push"
          ? "pushing limits"
          : focus === "deficit"
            ? "fixing weak skillsets"
            : "general";

  if (skill.overall <= 0) {
    return "Not enough 7K Sunny-rated plays to estimate skill yet. Play more 7K maps or run Sunny dan backfill in Settings.";
  }

  const cold = skill.coldStart ? " (cold start)" : "";
  if (focus === "push") {
    return `Found ${count} maps for pushing above your 90–95% clear level (~${formatSunny(skill.peakOverall)} Sunny)${cold}`;
  }
  return `Found ${count} maps for ${focusLabel} at skill level ${formatSunny(skill.overall)}${cold}`;
}

export type RecommendOptions = {
  focus?: RecommendFocus | string;
  skillset?: SkillAxis | string | null;
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

function parseSkillset(
  value: string | null | undefined,
): "rc" | "ln" | null {
  const v = (value ?? "").toLowerCase();
  if (v === "rc" || v === "ln") return v;
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
  const overlayQ = toStructuredOverlay(opts.q);
  if (overlayQ) {
    const ast = parseQuery(overlayQ);
    const compiled = compileQuery(ast);
    overlaySql = compiled.sql;
    overlayParams = compiled.params;
  }

  const overlay = { sql: overlaySql, params: overlayParams };
  const totalMapsConsidered = countSevenKWithSunny(db);

  if (skill.overall <= 0 || totalMapsConsidered === 0) {
    return {
      focus,
      targetSkillset: skillset,
      skill,
      summary: summaryFor(focus, skillset, skill, 0),
      totalMapsConsidered,
      needsSunnyBackfill,
      recommendations: [],
    };
  }

  // Companella defaults skillset focus to the player's strongest axis.
  if (focus === "skillset" && !skillset) {
    skillset = skill.rc >= skill.ln ? "rc" : "ln";
  }

  let recommendations: RecommendItem[] = [];
  let resolvedSkillset: SkillAxis | null = null;

  switch (focus) {
    case "consistency":
      recommendations = recommendConsistency(
        db,
        skill,
        count,
        overlay,
        excludeIds,
      );
      break;
    case "deficit": {
      const weak = weakestAxis(skill);
      resolvedSkillset = weak;
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
      resolvedSkillset = skillset ?? "rc";
      recommendations = recommendSkillset(
        db,
        skill,
        skillset ?? "rc",
        count,
        overlay,
        excludeIds,
      );
      break;
    case "push":
    default:
      recommendations = recommendPush(db, skill, count, overlay, excludeIds);
      break;
  }

  return {
    focus,
    targetSkillset: resolvedSkillset,
    skill,
    summary: summaryFor(focus, resolvedSkillset, skill, recommendations.length),
    totalMapsConsidered,
    needsSunnyBackfill,
    recommendations,
  };
}
