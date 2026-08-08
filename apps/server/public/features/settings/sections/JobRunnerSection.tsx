import type { ReactNode } from "react";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict, t } from "../../../lib/i18n";

export type JobCoverage = {
  computed: number;
  missing: number;
  failed: number;
};

type JobRunnerSectionProps = {
  sectionId: string;
  title: string;
  desc: string;
  coverage: JobCoverage | null;
  progressPct: number;
  running: boolean;
  statusText: ReactNode;
  totalLabel: string;
  startLabel: string;
  startRunningLabel: string;
  startPending: boolean;
  onStart: () => void;
  stopPending: boolean;
  stopDisabled?: boolean;
  stopStatusLabel: string;
  onStop: () => void;
  startError?: string | null;
  stopError?: string | null;
  jobError?: string | null;
  headerExtra?: ReactNode;
  extraActions?: ReactNode;
};

export function JobRunnerSection({
  sectionId,
  title,
  desc,
  coverage,
  progressPct,
  running,
  statusText,
  totalLabel,
  startLabel,
  startRunningLabel,
  startPending,
  onStart,
  stopPending,
  stopDisabled,
  stopStatusLabel,
  onStop,
  startError,
  stopError,
  jobError,
  headerExtra,
  extraActions,
}: JobRunnerSectionProps) {
  const { dict } = useAppDict();

  return (
    <section
      id={pageSectionDomId(sectionId)}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{desc}</p>
      {headerExtra}

      {coverage ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
            <span>
              <span className="font-semibold text-ink">
                {coverage.computed.toLocaleString()}
              </span>
              {" / "}
              {totalLabel}
            </span>
            <span>
              {t(dict?.settings.remaining, {
                count: coverage.missing.toLocaleString(),
              })}
            </span>
            {coverage.failed > 0 ? (
              <span className="text-rose-300/90">
                {t(dict?.settings.failed, {
                  count: coverage.failed.toLocaleString(),
                })}
              </span>
            ) : null}
          </div>

          <div className="h-2 overflow-hidden rounded bg-elevated">
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <p className="text-xs text-faint">{statusText}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {dict?.settings.loadingCoverage}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={
            running || startPending || (coverage?.missing ?? 0) === 0
          }
          onClick={onStart}
        >
          {running ? startRunningLabel : startLabel}
        </button>
        {extraActions}
        <button
          type="button"
          className="rx-btn"
          disabled={!running || stopPending || stopDisabled}
          onClick={onStop}
        >
          {stopStatusLabel}
        </button>
      </div>

      {startError ? (
        <p className="mt-3 text-sm text-rose-300">{startError}</p>
      ) : null}
      {stopError ? (
        <p className="mt-3 text-sm text-rose-300">{stopError}</p>
      ) : null}
      {jobError ? (
        <p className="mt-3 text-sm text-rose-300">{jobError}</p>
      ) : null}
    </section>
  );
}
