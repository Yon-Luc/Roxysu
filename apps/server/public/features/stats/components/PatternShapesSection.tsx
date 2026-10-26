import { useEffect, useState } from "react";
import { ToggleGroup } from "../../../components/ToggleGroup";
import { EmptyChart } from "../../../components/EmptyChart";
import { formatPatternLabel } from "../../../components/mania-analysis/formatPatternLabel";
import { formatSkillRating, type RatingDisplayMode } from "../../../lib/ratingDisplay";
import { useAppDict, t } from "../../../lib/i18n";
import { useChartStyles } from "../../../lib/chartStyles";
import type { Dictionary } from "@roxysu/i18n";
import type { PlayerStats, SkillBandKind, StatsSkillAxis } from "../../../lib/api";
import { skillRatingAxis, skillBandValue } from "../statsHelpers";
import { SkillBandPlaysPanel } from "./SkillBandPlaysPanel";

type PatternShapeStat = NonNullable<PlayerStats["patternShapes"]>["shapes"][number];

/** Band field on the Current skill profile ("push" reads the peak band). */
const SKILL_FIELD: Record<SkillBandKind, "peak" | "accuracy" | "consistency"> = {
  push: "peak",
  accuracy: "accuracy",
  consistency: "consistency",
};

/** One ranked row: chart shape, clear level, relative bar, map count. */
function ShapeRow({
  shape,
  stat,
  floor,
  maxLevel,
  band,
  axis,
  topPlays,
  keyCount,
  ratingMode,
  chartColor,
  expanded,
  onToggle,
  dict,
}: {
  shape: string;
  stat: PatternShapeStat["bands"][SkillBandKind]["all"];
  floor: number;
  maxLevel: number;
  band: SkillBandKind;
  axis: StatsSkillAxis;
  topPlays: number;
  keyCount: number;
  ratingMode: RatingDisplayMode;
  chartColor: string;
  expanded: boolean;
  onToggle: () => void;
  dict: Dictionary["app"] | undefined;
}) {
  const label = formatPatternLabel(shape, dict?.practice.detail.patterns);
  const qualified = stat.maps >= floor;
  const width = qualified && maxLevel > 0
    ? Math.max(4, Math.round((stat.level / maxLevel) * 100))
    : 0;

  if (!qualified) {
    return (
      <li
        className="flex items-center gap-3 px-4 py-2.5 text-xs text-muted opacity-60"
      >
        <span className="min-w-0 flex-1 truncate font-semibold">
          {label}
        </span>
        <span className="shrink-0 tabular-nums">
          {t(dict?.stats.mapsInBandRequired, {
            count: stat.maps,
            required: floor,
          })}
        </span>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-controls={`skill-band-${band}-pattern`}
        aria-expanded={expanded}
        className="w-full px-4 py-2.5 text-left transition hover:bg-elevated/30"
      >
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">
            {label}
            {expanded ? (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-faint">
                {dict?.stats.hide ?? "Hide"}
              </span>
            ) : null}
          </span>
          <span className="relative h-4 w-32 shrink-0 overflow-hidden rounded-full bg-white/8">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${width}%`, background: chartColor }}
            />
          </span>
          <span className="w-32 shrink-0 text-right font-semibold tabular-nums text-ink">
            {formatSkillRating({
              mode: ratingMode,
              reworkStar: stat.level,
              axis: skillRatingAxis(axis),
            })}
          </span>
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
            {t(dict?.stats.mapsCount, { count: stat.maps })}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Best / weakest chart-shape panel under Current skill. */
export function PatternShapesSection({
  data,
  skill,
  axis,
  topPlays,
  keyCount,
  ratingMode,
}: {
  data: PlayerStats["patternShapes"] | undefined;
  skill: PlayerStats["skill"];
  axis: StatsSkillAxis;
  topPlays: number;
  keyCount: number;
  ratingMode: RatingDisplayMode;
}) {
  const { dict } = useAppDict();
  const charts = useChartStyles();
  const [band, setBand] = useState<SkillBandKind>("push");
  const [expandedShape, setExpandedShape] = useState<string | null>(null);

  // Filter changes reset any open shape list, like the skill-band panels do.
  useEffect(() => {
    setExpandedShape(null);
  }, [band, axis, topPlays, keyCount]);

  const floor = data?.floor ?? 5;
  const rows = (data?.shapes ?? [])
    .map((row) => ({ shape: row.shape, stat: row.bands[band][axis] }))
    .filter((r) => r.stat.maps > 0)
    .sort((a, b) => {
      const qa = a.stat.maps >= floor ? 1 : 0;
      const qb = b.stat.maps >= floor ? 1 : 0;
      if (qa !== qb) return qb - qa;
      if (qa && a.stat.level !== b.stat.level) return b.stat.level - a.stat.level;
      return a.shape.localeCompare(b.shape);
    });

  const qualified = rows.filter((r) => r.stat.maps >= floor);
  const maxLevel = qualified.reduce((m, r) => Math.max(m, r.stat.level), 0);

  // Best: highest level (ties → more maps). Weakest: lowest (ties → fewer).
  const best =
    qualified.length >= 2
      ? qualified.reduce((a, b) =>
          b.stat.level > a.stat.level ||
          (b.stat.level === a.stat.level && b.stat.maps > a.stat.maps)
            ? b
            : a,
        )
      : null;
  const weakest =
    qualified.length >= 2
      ? qualified.reduce((a, b) =>
          b.stat.level < a.stat.level ||
          (b.stat.level === a.stat.level && b.stat.maps < a.stat.maps)
            ? b
            : a,
        )
      : null;

  const base = skillBandValue(skill, SKILL_FIELD[band], axis);
  const gapOf = (level: number) => ({
    diff: level - base,
    even: base > 0 && Math.abs(level - base) < 0.25,
  });
  const bandTitle =
    band === "push"
      ? dict?.stats.bandPush ?? "Push"
      : band === "accuracy"
        ? dict?.stats.bandAccuracy ?? "Accuracy"
        : dict?.stats.bandConsistency ?? "Consistency";

  const callout = (
    kind: "best" | "weakest",
    pick: { shape: string; stat: PatternShapeStat["bands"][SkillBandKind]["all"] } | null,
  ) => {
    const titleKey =
      kind === "best" ? dict?.stats.bestPattern : dict?.stats.weakestPattern;
    if (!pick) return null;
    const { diff, even } = gapOf(pick.stat.level);
    return (
      <button
        type="button"
        onClick={() =>
          setExpandedShape((prev) =>
            prev === pick.shape ? null : pick.shape,
          )
        }
        aria-controls={`skill-band-${band}-pattern`}
        className={`rx-panel w-full px-4 py-4 text-left transition ${
          expandedShape === pick.shape ? "ring-1 ring-accent/40" : "hover:bg-elevated/30"
        }`}
      >
        <div className="rx-label">
          {kind === "best"
            ? dict?.stats.bestPattern ?? "Best pattern"
            : dict?.stats.weakestPattern ?? "Weakest pattern"}
        </div>
        <div className="mt-1 font-display text-lg font-bold text-ink">
          {formatPatternLabel(pick.shape, dict?.practice.detail.patterns)}
        </div>
        <div className="mt-1 font-semibold tabular-nums text-ink">
          {formatSkillRating({
            mode: ratingMode,
            reworkStar: pick.stat.level,
            axis: skillRatingAxis(axis),
          })}
        </div>
        <p className="mt-1 text-xs text-muted">
          {base > 0
            ? even
              ? t(dict?.stats.patternEven, { band: bandTitle })
              : t(dict?.stats.patternVsBand, {
                  sign: diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1),
                  band: bandTitle,
                })
            : t(dict?.stats.mapsCount, { count: pick.stat.maps })}
        </p>
        <span className="sr-only">{titleKey}</span>
      </button>
    );
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">
          {dict?.stats.patternsTitle ?? "Patterns"}
        </h2>
        <ToggleGroup
          value={band}
          options={[
            { id: "push", label: dict?.stats.bandPush ?? "Push" },
            { id: "accuracy", label: dict?.stats.bandAccuracy ?? "Accuracy" },
            {
              id: "consistency",
              label: dict?.stats.bandConsistency ?? "Consistency",
            },
          ]}
          onChange={(v) => setBand(v as SkillBandKind)}
        />
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-medium text-subtle">
          {dict?.stats.patternsHintTitle ?? "What is this?"}
        </summary>
        <p className="mt-1 max-w-3xl leading-relaxed">
          {dict?.stats.patternsHint ??
            "Clear level per chart shape — the same Push / Accuracy / Consistency reading as Current skill, restricted to maps whose primary shape is that family."}
        </p>
      </details>

      {rows.length === 0 ? (
        <EmptyChart
          message={
            dict?.stats.patternsBackfillHint ??
            "Chart shapes come from the rework dan backfill — run it in Settings to fill this section."
          }
        />
      ) : (
        <>
          {best && weakest ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {callout("best", best)}
              {callout("weakest", weakest)}
            </div>
          ) : (
            <p className="mb-4 text-xs text-muted">
              {t(dict?.stats.patternsNotEnoughShapes, { required: floor })}
            </p>
          )}
          <ul className="rx-panel divide-y divide-white/6">
            {rows.map((row) => (
              <ShapeRow
                key={row.shape}
                shape={row.shape}
                stat={row.stat}
                floor={floor}
                maxLevel={maxLevel}
                band={band}
                axis={axis}
                topPlays={topPlays}
                keyCount={keyCount}
                ratingMode={ratingMode}
                chartColor={charts.chartAlt}
                expanded={expandedShape === row.shape}
                onToggle={() =>
                  setExpandedShape((prev) =>
                    prev === row.shape ? null : row.shape,
                  )
                }
                dict={dict}
              />
            ))}
          </ul>
          {expandedShape ? (
            <div className="mt-4">
              <SkillBandPlaysPanel
                band={band}
                axis={axis}
                topPlays={topPlays}
                keyCount={keyCount}
                ratingMode={ratingMode}
                shape={expandedShape}
                heading={formatPatternLabel(
                  expandedShape,
                  dict?.practice.detail.patterns,
                )}
                idSuffix="-pattern"
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
