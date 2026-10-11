import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  fetchDanielDanJob,
  fetchPatternAnalysisJob,
  fetchReworkDanJob,
  fetchSunnyDanJob,
  stopAllJobs,
  type DanielDanJob,
  type PatternAnalysisJob,
  type ReworkDanJob,
  type SunnyDanJob,
} from "../../lib/api";
import { pushToast } from "../../lib/toasts";

type JobLike = {
  status: string;
  coverage?: { computed?: number; missing?: number; maniaTotal?: number; total?: number };
  computedThisRun?: number;
  attemptedThisRun?: number;
};

const BUSY = new Set(["running", "stopping", "paused"]);

function isBusy(status: string | undefined): boolean {
  return !!status && BUSY.has(status);
}

function jobProgress(job: JobLike | undefined): {
  done: number;
  total: number;
  pct: number;
} {
  const computed = job?.coverage?.computed ?? 0;
  const missing = job?.coverage?.missing ?? 0;
  const total =
    job?.coverage?.maniaTotal ??
    job?.coverage?.total ??
    computed + missing;
  const pct = total > 0 ? Math.min(100, Math.round((computed / total) * 100)) : 0;
  return { done: computed, total, pct };
}

function aggregate(
  sunny?: SunnyDanJob,
  daniel?: DanielDanJob,
  rework?: ReworkDanJob,
  pattern?: PatternAnalysisJob,
) {
  const jobs = [
    { name: "Sunny", job: sunny },
    { name: "Daniel", job: daniel },
    { name: "Rework", job: rework },
    { name: "Pattern", job: pattern },
  ].filter((j) => isBusy(j.job?.status));

  let done = 0;
  let total = 0;
  for (const j of jobs) {
    const p = jobProgress(j.job as JobLike);
    done += p.done;
    total += p.total;
  }
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const labels = jobs.map((j) => j.name);
  const paused = jobs.some((j) => j.job?.status === "paused");
  const stopping = jobs.some((j) => j.job?.status === "stopping");
  return { jobs, labels, done, total, pct, paused, stopping, busy: jobs.length > 0 };
}

/**
 * App-wide Jobs chrome: completion toasts + floating progress when away
 * from Settings.
 */
export function JobsBatchChrome() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onSettings = pathname === "/settings";
  const queryClient = useQueryClient();

  const sunnyQuery = useQuery({
    queryKey: ["settings", "sunny-dan"],
    queryFn: fetchSunnyDanJob,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1000 : false),
  });
  const danielQuery = useQuery({
    queryKey: ["settings", "daniel-dan"],
    queryFn: fetchDanielDanJob,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1000 : false),
  });
  const reworkQuery = useQuery({
    queryKey: ["settings", "rework-dan"],
    queryFn: fetchReworkDanJob,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1000 : false),
  });
  const patternQuery = useQuery({
    queryKey: ["settings", "pattern-analysis"],
    queryFn: fetchPatternAnalysisJob,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1000 : false),
  });

  const sunny = sunnyQuery.data;
  const daniel = danielQuery.data;
  const rework = reworkQuery.data;
  const pattern = patternQuery.data;
  const agg = aggregate(sunny, daniel, rework, pattern);

  useJobsCompletionToasts(sunny, daniel, rework, pattern, agg.busy);

  const stopMutation = useMutation({
    mutationFn: stopAllJobs,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (!agg.busy || onSettings) return null;
  if (typeof document === "undefined") return null;

  const statusLine = agg.stopping
    ? "Stopping…"
    : agg.paused
      ? "Paused — waiting for memory"
      : `Computing ${agg.labels.join(" · ")}`;

  return createPortal(
    <div className="fixed bottom-40 right-4 z-55 w-72 max-w-[calc(100vw-2rem)] md:bottom-24">
      <div className="rounded-lg border border-border bg-elevated/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/settings"
            search={{ tab: "jobs" }}
            className="min-w-0 flex-1 space-y-0.5 no-underline"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">
              Jobs
            </p>
            <p className="truncate text-sm text-ink">{statusLine}</p>
            <p className="text-xs text-muted">
              {agg.total > 0 ? `${agg.pct}%` : null}
              {agg.total > 0
                ? ` · ${agg.done.toLocaleString()} / ${agg.total.toLocaleString()}`
                : null}
            </p>
          </Link>
          <button
            type="button"
            className="rx-btn shrink-0 px-2 py-1 text-xs"
            disabled={stopMutation.isPending}
            onClick={() => stopMutation.mutate()}
          >
            {stopMutation.isPending ? "…" : "Stop"}
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-canvas">
          <div
            className="h-full bg-accent transition-[width] duration-500"
            style={{ width: `${agg.pct}%` }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useJobsCompletionToasts(
  sunny: SunnyDanJob | undefined,
  daniel: DanielDanJob | undefined,
  rework: ReworkDanJob | undefined,
  pattern: PatternAnalysisJob | undefined,
  busy: boolean,
) {
  const prevBusyRef = useRef(false);
  const prevStatusesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const statuses: Record<string, string> = {
      sunny: sunny?.status ?? "idle",
      daniel: daniel?.status ?? "idle",
      rework: rework?.status ?? "idle",
      pattern: pattern?.status ?? "idle",
    };
    const wasBusy = prevBusyRef.current;
    const prev = prevStatusesRef.current;
    prevBusyRef.current = busy;
    prevStatusesRef.current = statuses;

    if (!wasBusy || busy) return;

    const finishedNames: string[] = [];
    let hadError = false;
    for (const [name, status] of Object.entries(statuses)) {
      const prevStatus = prev[name];
      if (
        (prevStatus === "running" ||
          prevStatus === "stopping" ||
          prevStatus === "paused") &&
        (status === "completed" || status === "error" || status === "idle")
      ) {
        finishedNames.push(name);
        if (status === "error") hadError = true;
      }
    }
    if (finishedNames.length === 0) return;

    pushToast({
      title: hadError ? "Jobs finished with errors" : "Jobs finished",
      detail: finishedNames
        .map((n) => n[0]!.toUpperCase() + n.slice(1))
        .join(", "),
      tone: hadError ? "error" : "success",
      action: {
        label: "Open Jobs",
        onClick: () => {
          window.location.hash = "#/settings?tab=jobs";
        },
      },
    });
  }, [sunny, daniel, rework, pattern, busy]);
}
