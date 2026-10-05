import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { t, useAppDict } from "../../../lib/i18n";

function toPct(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function fromPct(pct: number): number {
  return Math.round(pct * 10) / 1000;
}

function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function AxisThresholdsSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const current = data.axisThresholds;
  const defaults = current?.defaults ?? { ln: 0.2, fln: 0.8 };

  const [lnPct, setLnPct] = useState(() => toPct(current?.ln ?? defaults.ln));
  const [flnPct, setFlnPct] = useState(() =>
    toPct(current?.fln ?? defaults.fln),
  );

  useEffect(() => {
    if (!current) return;
    setLnPct(toPct(current.ln));
    setFlnPct(toPct(current.fln));
  }, [current?.ln, current?.fln]);

  const lnRatio = fromPct(lnPct);
  const flnRatio = fromPct(flnPct);
  const invalid = !(lnRatio > 0 && flnRatio <= 1 && lnRatio < flnRatio);
  const dirty =
    current != null &&
    (Math.abs(lnRatio - current.ln) > 1e-9 ||
      Math.abs(flnRatio - current.fln) > 1e-9);

  const preview = useMemo(() => {
    const ln = clampPct(lnPct, 1, 99);
    const fln = clampPct(flnPct, 1, 100);
    return {
      rice: `< ${ln}%`,
      ln: `${ln}–${fln}%`,
      fln: `≥ ${fln}%`,
    };
  }, [lnPct, flnPct]);

  const mut = useMutation({
    mutationFn: (body: {
      lnRatioThreshold: number;
      flnRatioThreshold: number;
    }) => patchSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const save = () => {
    if (invalid) return;
    mut.mutate({
      lnRatioThreshold: lnRatio,
      flnRatioThreshold: flnRatio,
    });
  };

  const reset = () => {
    setLnPct(toPct(defaults.ln));
    setFlnPct(toPct(defaults.fln));
    mut.mutate({
      lnRatioThreshold: defaults.ln,
      flnRatioThreshold: defaults.fln,
    });
  };

  return (
    <section
      id={pageSectionDomId("axis-thresholds")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.axisThresholds ?? "Rice / LN / FLN boundaries"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.axisThresholdsDesc ??
          "Choose when maps count as Rice, LN, or full LN for recommendations, skill axes, stats mix, and axis: filters. Sunny dan labels stay at the standard 20% RC/LN split."}
      </p>

      <div className="mt-5 space-y-5">
        <label className="block">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-ink">
              {dict?.settings.axisLnStart ?? "LN starts at"}
            </span>
            <span className="font-mono text-sm text-muted">{lnPct}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={99}
            step={0.5}
            value={lnPct}
            disabled={mut.isPending}
            onChange={(e) => {
              const next = Number(e.target.value);
              setLnPct(next);
              if (next >= flnPct) setFlnPct(Math.min(100, next + 1));
            }}
            className="mt-2 w-full accent-[var(--color-accent)]"
          />
          <p className="mt-1 text-xs text-faint">
            {dict?.settings.axisLnStartHint ??
              "Below this % long notes → Rice; at or above → LN (until FLN)."}
          </p>
        </label>

        <label className="block">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-ink">
              {dict?.settings.axisFlnStart ?? "FLN starts at"}
            </span>
            <span className="font-mono text-sm text-muted">{flnPct}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={0.5}
            value={flnPct}
            disabled={mut.isPending}
            onChange={(e) => {
              const next = Number(e.target.value);
              setFlnPct(next);
              if (next <= lnPct) setLnPct(Math.max(1, next - 1));
            }}
            className="mt-2 w-full accent-[var(--color-accent)]"
          />
          <p className="mt-1 text-xs text-faint">
            {dict?.settings.axisFlnStartHint ??
              "At or above this % long notes → full LN (FLN)."}
          </p>
        </label>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-elevated/50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict?.stats.axisRice ?? "Rice"}
          </div>
          <div className="mt-0.5 font-mono text-sm text-ink">{preview.rice}</div>
        </div>
        <div className="rounded-xl bg-elevated/50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict?.stats.axisLn ?? "LN"}
          </div>
          <div className="mt-0.5 font-mono text-sm text-ink">{preview.ln}</div>
        </div>
        <div className="rounded-xl bg-elevated/50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict?.stats.axisFln ?? "FLN"}
          </div>
          <div className="mt-0.5 font-mono text-sm text-ink">{preview.fln}</div>
        </div>
      </div>

      {invalid ? (
        <p className="mt-3 text-sm text-danger">
          {dict?.settings.axisThresholdsInvalid ??
            "LN start must be less than FLN start."}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={mut.isPending || invalid || !dirty}
          onClick={save}
        >
          {mut.isPending
            ? (dict?.settings.saving ?? "Saving…")
            : (dict?.settings.saveAxisThresholds ?? "Save boundaries")}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={mut.isPending}
          onClick={reset}
        >
          {t(dict?.settings.resetToDefaults, {
            ln: toPct(defaults.ln),
            fln: toPct(defaults.fln),
          }) || `Reset to ${toPct(defaults.ln)}% / ${toPct(defaults.fln)}%`}
        </button>
      </div>

      {mut.error ? (
        <p className="mt-3 text-sm text-danger">{mut.error.message}</p>
      ) : null}
    </section>
  );
}
