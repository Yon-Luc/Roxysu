import { formatSkillRating, type RatingDisplayMode, type SkillRatingAxis } from "../../../lib/ratingDisplay";
import { skillRatingAxis } from "../statsHelpers";
import type { SkillBandKind, StatsSkillAxis } from "../../../lib/api";
import { useAppDict, t } from "../../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";

function AxisCell({
  mode,
  axis,
  dict,
  label,
  value,
  maps,
  requiredPlays,
}: {
  mode: RatingDisplayMode;
  axis: SkillRatingAxis;
  dict: Dictionary["app"] | undefined;
  label: string;
  value: number;
  maps: number;
  requiredPlays: number;
}) {
  const hasEstimate = value > 0 && maps >= requiredPlays;
  return (
    <div>
      <div className="text-faint">{label}</div>
      <div
        className={`mt-0.5 font-semibold tabular-nums text-ink ${
          mode === "dan" ? "text-[11px] leading-tight" : ""
        }`}
      >
        {hasEstimate
          ? formatSkillRating({ mode, sunnyStar: value, axis })
          : "—"}
      </div>
      <div className="text-[10px] text-faint">
        {maps >= requiredPlays
          ? t(dict?.stats.mapsCount, { count: maps })
          : maps > 0
            ? `${maps}/${requiredPlays}`
            : dict?.stats.zeroMaps ?? "0 maps"}
      </div>
    </div>
  );
}

export function SkillCard({
  mode,
  axis,
  band,
  title,
  hint,
  value,
  maps,
  requiredPlays,
  expanded,
  onToggle,
  breakdown,
}: {
  mode: RatingDisplayMode;
  axis: StatsSkillAxis;
  band: SkillBandKind;
  title: string;
  hint: string;
  value: number;
  maps: number;
  requiredPlays: number;
  expanded: boolean;
  onToggle: () => void;
  breakdown: {
    rc: number;
    ln: number;
    fln: number;
    rcMaps: number;
    lnMaps: number;
    flnMaps: number;
  } | null;
}) {
  const { dict } = useAppDict();
  const hasEstimate = value > 0;
  const playsLabel =
    maps === 0
      ? dict?.stats.noPlaysInBand ?? "No plays in band yet"
      : hasEstimate
        ? t(dict?.stats.mapsInBand, { count: maps })
        : t(dict?.stats.mapsInBandRequired, {
            count: maps,
            required: requiredPlays,
          });

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rx-panel w-full px-4 py-4 text-left transition ${
        expanded
          ? "ring-1 ring-accent/40"
          : "hover:bg-elevated/30"
      }`}
      aria-expanded={expanded}
      aria-controls={`skill-band-${band}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="rx-label">{title}</div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-faint">
          {expanded
            ? dict?.stats.hide ?? "Hide"
            : dict?.stats.plays ?? "plays"}
        </span>
      </div>
      <div
        className={`mt-2 font-bold tabular-nums text-ink ${
          mode === "dan" ? "text-xl leading-snug" : "text-3xl"
        }`}
      >
        {hasEstimate
          ? formatSkillRating({
              mode,
              sunnyStar: value,
              axis: skillRatingAxis(axis),
            })
          : "—"}
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {breakdown ? (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <AxisCell
            mode={mode}
            axis="rc"
            dict={dict}
            label={dict?.stats.axisRice ?? "Rice"}
            value={breakdown.rc}
            maps={breakdown.rcMaps}
            requiredPlays={requiredPlays}
          />
          <AxisCell
            mode={mode}
            axis="ln"
            dict={dict}
            label={dict?.stats.axisLn ?? "LN"}
            value={breakdown.ln}
            maps={breakdown.lnMaps}
            requiredPlays={requiredPlays}
          />
          <AxisCell
            mode={mode}
            axis="fln"
            dict={dict}
            label={dict?.stats.axisFln ?? "FLN"}
            value={breakdown.fln}
            maps={breakdown.flnMaps}
            requiredPlays={requiredPlays}
          />
        </div>
      ) : (
        <p className="mt-4 text-xs text-faint">
          {playsLabel}
          {!hasEstimate && maps > 0
            ? ` · ${t(dict?.stats.needMorePlays, {
                required: requiredPlays,
              })}`
            : ""}
        </p>
      )}
    </button>
  );
}
