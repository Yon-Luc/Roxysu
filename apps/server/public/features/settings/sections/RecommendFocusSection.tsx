import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSettings, type SettingsPayload } from "../../../lib/api";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

type BandDraft = {
  accMinPct: number;
  accMaxPct: number;
  targetPct: number;
  tolerancePct: number;
};

type Draft = {
  push: BandDraft;
  accuracy: BandDraft;
  consistency: BandDraft;
  deficitTargetPct: number;
  deficitTolerancePct: number;
  topPlays: number;
};

function toAccPct(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function fromAccPct(pct: number): number {
  return Math.round(pct * 10) / 1000;
}

function toRatioPct(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function fromRatioPct(pct: number): number {
  return Math.round(pct * 10) / 1000;
}

function bandFromSettings(band: {
  accMin: number;
  accMax: number;
  targetRatio: number;
  tolerance: number;
}): BandDraft {
  return {
    accMinPct: toAccPct(band.accMin),
    accMaxPct: toAccPct(Math.min(band.accMax, 1)),
    targetPct: toRatioPct(band.targetRatio),
    tolerancePct: toRatioPct(band.tolerance),
  };
}

function draftFromPayload(
  focus: NonNullable<SettingsPayload["recommendFocus"]>,
): Draft {
  return {
    push: bandFromSettings(focus.push),
    accuracy: {
      ...bandFromSettings(focus.accuracy),
      // Accuracy upper can be >100% in storage (1.01); show as 100 for the slider.
      accMaxPct: focus.accuracy.accMax > 1 ? 100 : toAccPct(focus.accuracy.accMax),
    },
    consistency: bandFromSettings(focus.consistency),
    deficitTargetPct: toRatioPct(focus.deficit.targetRatio),
    deficitTolerancePct: toRatioPct(focus.deficit.tolerance),
    topPlays: focus.topPlays,
  };
}

function bandToApi(
  band: BandDraft,
  opts?: { openEndedMax?: boolean },
): {
  accMin: number;
  accMax: number;
  targetRatio: number;
  tolerance: number;
} {
  const accMin = fromAccPct(band.accMinPct);
  let accMax = fromAccPct(band.accMaxPct);
  if (opts?.openEndedMax && band.accMaxPct >= 100) {
    accMax = 1.01;
  }
  return {
    accMin,
    accMax,
    targetRatio: fromRatioPct(band.targetPct),
    tolerance: fromRatioPct(band.tolerancePct),
  };
}

const CLEAR_RATE_MIN = 80;
const CLEAR_RATE_MAX = 100;
const CLEAR_RATE_STEP = 0.5;
const CLEAR_RATE_GAP = 0.5;

function ClearRateBandSlider({
  minPct,
  maxPct,
  onChange,
  disabled,
  minAriaLabel,
  maxAriaLabel,
}: {
  minPct: number;
  maxPct: number;
  onChange: (minPct: number, maxPct: number) => void;
  disabled?: boolean;
  minAriaLabel: string;
  maxAriaLabel: string;
}) {
  const span = CLEAR_RATE_MAX - CLEAR_RATE_MIN;
  const minPos = ((minPct - CLEAR_RATE_MIN) / span) * 100;
  const maxPos = ((maxPct - CLEAR_RATE_MIN) / span) * 100;
  // Keep the nearer-edge thumb on top so either can still be grabbed when close.
  const minOnTop = minPct > CLEAR_RATE_MAX - span * 0.25;

  return (
    <div className="rx-dual-range relative mt-1.5 h-6">
      <div
        className="pointer-events-none absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-highlight"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
        style={{ left: `${minPos}%`, width: `${Math.max(0, maxPos - minPos)}%` }}
        aria-hidden
      />
      <input
        type="range"
        min={CLEAR_RATE_MIN}
        max={CLEAR_RATE_MAX}
        step={CLEAR_RATE_STEP}
        value={minPct}
        disabled={disabled}
        aria-label={minAriaLabel}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Math.min(next, maxPct - CLEAR_RATE_GAP), maxPct);
        }}
        style={{ zIndex: minOnTop ? 4 : 3 }}
      />
      <input
        type="range"
        min={CLEAR_RATE_MIN}
        max={CLEAR_RATE_MAX}
        step={CLEAR_RATE_STEP}
        value={maxPct}
        disabled={disabled}
        aria-label={maxAriaLabel}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(minPct, Math.max(next, minPct + CLEAR_RATE_GAP));
        }}
        style={{ zIndex: minOnTop ? 3 : 4 }}
      />
    </div>
  );
}

function BandEditors({
  title,
  hint,
  band,
  onChange,
  openEndedMax,
  disabled,
}: {
  title: string;
  hint: string;
  band: BandDraft;
  onChange: (next: BandDraft) => void;
  openEndedMax?: boolean;
  disabled?: boolean;
}) {
  const { dict } = useAppDict();
  const bandLabel =
    openEndedMax && band.accMaxPct >= 100
      ? `${band.accMinPct}%+`
      : `${band.accMinPct}–${band.accMaxPct}%`;

  return (
    <div className="rounded-xl bg-elevated/40 px-4 py-3 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
        <p className="mt-1 font-mono text-xs text-faint">
          {`Clear band: ${bandLabel} · target ${band.targetPct}% ±${band.tolerancePct}%`}
        </p>
      </div>

      <div>
        <div className="flex justify-between text-xs font-semibold text-ink">
          <span>
            {openEndedMax
              ? (dict?.settings.recommendFocusAccBandOpen ??
                "Clear-rate (100% = open-ended)")
              : (dict?.settings.recommendFocusAccBand ?? "Clear-rate")}
          </span>
          <span className="font-mono text-muted">{bandLabel}</span>
        </div>
        <ClearRateBandSlider
          minPct={band.accMinPct}
          maxPct={band.accMaxPct}
          disabled={disabled}
          minAriaLabel={
            dict?.settings.recommendFocusAccBand ?? "Clear-rate"
          }
          maxAriaLabel={
            openEndedMax
              ? (dict?.settings.recommendFocusAccBandOpen ??
                "Clear-rate (100% = open-ended)")
              : (dict?.settings.recommendFocusAccBand ?? "Clear-rate")
          }
          onChange={(accMinPct, accMaxPct) =>
            onChange({ ...band, accMinPct, accMaxPct })
          }
        />
      </div>

      <label className="block">
        <div className="flex justify-between text-xs font-semibold text-ink">
          <span>
            {dict?.settings.recommendFocusTarget ??
              "Target difficulty (100% = same as band skill)"}
          </span>
          <span className="font-mono text-muted">{band.targetPct}%</span>
        </div>
        <input
          type="range"
          min={80}
          max={120}
          step={1}
          value={band.targetPct}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...band, targetPct: Number(e.target.value) })
          }
          className="mt-1.5 w-full accent-[var(--color-accent)]"
        />
      </label>

      <label className="block">
        <div className="flex justify-between text-xs font-semibold text-ink">
          <span>
            {dict?.settings.recommendFocusTolerance ?? "Difficulty window ±"}
          </span>
          <span className="font-mono text-muted">{band.tolerancePct}%</span>
        </div>
        <input
          type="range"
          min={2}
          max={25}
          step={1}
          value={band.tolerancePct}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...band, tolerancePct: Number(e.target.value) })
          }
          className="mt-1.5 w-full accent-[var(--color-accent)]"
        />
      </label>
    </div>
  );
}

export function RecommendFocusSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();
  const current = data.recommendFocus;
  const defaults = current?.defaults;

  const [draft, setDraft] = useState<Draft | null>(() =>
    current ? draftFromPayload(current) : null,
  );

  useEffect(() => {
    if (!current) return;
    setDraft(draftFromPayload(current));
  }, [current]);

  const mut = useMutation({
    mutationFn: (body: { recommendFocus: ReturnType<typeof toApiBody> }) =>
      patchSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const toApiBody = (d: Draft) => ({
    push: bandToApi(d.push),
    accuracy: bandToApi(d.accuracy, { openEndedMax: true }),
    consistency: bandToApi(d.consistency),
    deficit: {
      targetRatio: fromRatioPct(d.deficitTargetPct),
      tolerance: fromRatioPct(d.deficitTolerancePct),
    },
    topPlays: Math.round(d.topPlays),
  });

  const invalid = useMemo(() => {
    if (!draft) return true;
    for (const band of [draft.push, draft.accuracy, draft.consistency]) {
      if (!(band.accMinPct < band.accMaxPct)) return true;
      if (band.targetPct < 70 || band.targetPct > 140) return true;
      if (band.tolerancePct < 2 || band.tolerancePct > 35) return true;
    }
    if (draft.topPlays < 1 || draft.topPlays > 500) return true;
    return false;
  }, [draft]);

  const dirty = useMemo(() => {
    if (!draft || !current) return false;
    const api = toApiBody(draft);
    return (
      JSON.stringify(api.push) !== JSON.stringify({
        accMin: current.push.accMin,
        accMax: current.push.accMax,
        targetRatio: current.push.targetRatio,
        tolerance: current.push.tolerance,
      }) ||
      JSON.stringify(api.accuracy) !==
        JSON.stringify({
          accMin: current.accuracy.accMin,
          accMax: current.accuracy.accMax,
          targetRatio: current.accuracy.targetRatio,
          tolerance: current.accuracy.tolerance,
        }) ||
      JSON.stringify(api.consistency) !==
        JSON.stringify({
          accMin: current.consistency.accMin,
          accMax: current.consistency.accMax,
          targetRatio: current.consistency.targetRatio,
          tolerance: current.consistency.tolerance,
        }) ||
      Math.abs(api.deficit.targetRatio - current.deficit.targetRatio) > 1e-9 ||
      Math.abs(api.deficit.tolerance - current.deficit.tolerance) > 1e-9 ||
      api.topPlays !== current.topPlays
    );
  }, [draft, current]);

  if (!draft || !current || !defaults) {
    return null;
  }

  const save = () => {
    if (invalid) return;
    mut.mutate({ recommendFocus: toApiBody(draft) });
  };

  const reset = () => {
    const next = draftFromPayload({ ...defaults, defaults });
    setDraft(next);
    mut.mutate({ recommendFocus: toApiBody(next) });
  };

  return (
    <section
      id={pageSectionDomId("recommend-focus")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.recommendFocus ?? "Recommendation focuses"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.recommendFocusDesc ??
          "Define Push, Accuracy, Consistency, and Deficit for Current Session recommendations — clear-rate bands and how hard maps should be relative to your top clears in that band."}
      </p>

      <label className="mt-5 block max-w-xs">
        <div className="flex justify-between text-sm font-semibold text-ink">
          <span>
            {dict?.settings.recommendFocusTopPlays ?? "Top clears per band"}
          </span>
          <span className="font-mono text-muted">{draft.topPlays}</span>
        </div>
        <input
          type="range"
          min={5}
          max={100}
          step={1}
          value={draft.topPlays}
          disabled={mut.isPending}
          onChange={(e) =>
            setDraft({ ...draft, topPlays: Number(e.target.value) })
          }
          className="mt-2 w-full accent-[var(--color-accent)]"
        />
        <p className="mt-1 text-xs text-faint">
          {dict?.settings.recommendFocusTopPlaysHint ??
            "How many of your hardest clears in each accuracy band define that band’s skill."}
        </p>
      </label>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <BandEditors
          title={dict?.session.focus.push ?? "Push"}
          hint={
            dict?.settings.recommendFocusPushHint ??
            "Solid clears used as your push baseline. Keep the band narrow (e.g. 90–95%) so harder farms do not inflate it."
          }
          band={draft.push}
          disabled={mut.isPending}
          onChange={(push) => setDraft({ ...draft, push })}
        />
        <BandEditors
          title={dict?.session.focus.accuracy ?? "Accuracy"}
          hint={
            dict?.settings.recommendFocusAccuracyHint ??
            "High-accuracy clears. Max at 100% means open-ended (99%+)."
          }
          band={draft.accuracy}
          openEndedMax
          disabled={mut.isPending}
          onChange={(accuracy) => setDraft({ ...draft, accuracy })}
        />
        <BandEditors
          title={dict?.session.focus.consistency ?? "Consistency"}
          hint={
            dict?.settings.recommendFocusConsistencyHint ??
            "Farm / polish band between push and accuracy."
          }
          band={draft.consistency}
          disabled={mut.isPending}
          onChange={(consistency) => setDraft({ ...draft, consistency })}
        />
        <div className="rounded-xl bg-elevated/40 px-4 py-3 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-ink">
              {dict?.session.focus.deficit ?? "Deficit"}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {dict?.settings.recommendFocusDeficitHint ??
                "Maps on your weakest Rice/LN/FLN axis, near that axis’s comfort skill."}
            </p>
          </div>
          <label className="block">
            <div className="flex justify-between text-xs font-semibold text-ink">
              <span>
                {dict?.settings.recommendFocusTarget ??
                  "Target difficulty (100% = same as band skill)"}
              </span>
              <span className="font-mono text-muted">
                {draft.deficitTargetPct}%
              </span>
            </div>
            <input
              type="range"
              min={80}
              max={120}
              step={1}
              value={draft.deficitTargetPct}
              disabled={mut.isPending}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  deficitTargetPct: Number(e.target.value),
                })
              }
              className="mt-1.5 w-full accent-[var(--color-accent)]"
            />
          </label>
          <label className="block">
            <div className="flex justify-between text-xs font-semibold text-ink">
              <span>
                {dict?.settings.recommendFocusTolerance ??
                  "Difficulty window ±"}
              </span>
              <span className="font-mono text-muted">
                {draft.deficitTolerancePct}%
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={25}
              step={1}
              value={draft.deficitTolerancePct}
              disabled={mut.isPending}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  deficitTolerancePct: Number(e.target.value),
                })
              }
              className="mt-1.5 w-full accent-[var(--color-accent)]"
            />
          </label>
        </div>
      </div>

      {invalid ? (
        <p className="mt-3 text-sm text-danger">
          {dict?.settings.recommendFocusInvalid ??
            "Each clear-rate min must be less than max."}
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
            : (dict?.settings.saveRecommendFocus ?? "Save focuses")}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={mut.isPending}
          onClick={reset}
        >
          {dict?.settings.resetRecommendFocus ?? "Reset to defaults"}
        </button>
      </div>

      {mut.error ? (
        <p className="mt-3 text-sm text-danger">{mut.error.message}</p>
      ) : null}
    </section>
  );
}
