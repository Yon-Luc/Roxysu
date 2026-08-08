import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPatternAnalysisJob,
  recomputePatternAnalysisJob,
  startPatternAnalysisJob,
  stopPatternAnalysisJob,
  type SettingsPayload,
} from "../../../lib/api";
import { statusLabel } from "../../../lib/settingsLabels";
import { useAppDict, t } from "../../../lib/i18n";
import { JobRunnerSection } from "./JobRunnerSection";

export function PatternAnalysisSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const patternAnalysisQuery = useQuery({
    queryKey: ["settings", "pattern-analysis"],
    queryFn: fetchPatternAnalysisJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const startPattern = useMutation({
    mutationFn: startPatternAnalysisJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "pattern-analysis"], state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const recomputePattern = useMutation({
    mutationFn: recomputePatternAnalysisJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "pattern-analysis"], state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const stopPattern = useMutation({
    mutationFn: stopPatternAnalysisJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "pattern-analysis"], state);
    },
  });

  const patternAnalysis = patternAnalysisQuery.data ?? data.patternAnalysis;
  const patternCoverage = patternAnalysis?.coverage;
  const patternRunning =
    patternAnalysis?.status === "running" ||
    patternAnalysis?.status === "stopping";
  const patternProgressPct =
    patternCoverage &&
    (patternCoverage.totalMania ?? patternCoverage.total7k) > 0
      ? Math.min(
          100,
          Math.round(
            (patternCoverage.computed /
              (patternCoverage.totalMania ?? patternCoverage.total7k)) *
              100,
          ),
        )
      : 0;
  const patternTotal =
    patternCoverage?.totalMania ?? patternCoverage?.total7k ?? 0;

  const statusText = (
    <>
      {statusLabel(dict, patternAnalysis?.status)}
      {patternRunning
        ? ` · ${t(dict?.settings.classifiedThisRun, {
            count: patternAnalysis.computedThisRun.toLocaleString(),
          })}`
        : null}
      {patternAnalysis?.status === "completed" &&
      patternAnalysis.computedThisRun > 0
        ? ` · ${t(dict?.settings.classified, {
            count: patternAnalysis.computedThisRun.toLocaleString(),
          })}`
        : null}
      {patternCoverage?.failed > 0 && !patternRunning
        ? ` · ${t(dict?.settings.unparsableSkipped, {
            count: patternCoverage.failed.toLocaleString(),
          })}`
        : null}
    </>
  );

  return (
    <JobRunnerSection
      sectionId="pattern-analysis"
      title={dict?.settings.patternAnalysis ?? "Pattern analysis"}
      desc={
        dict?.settings.patternAnalysisDesc ??
        "Classify 7K pattern difficulty for maps missing a rating."
      }
      headerExtra={
        <p className="mt-2 font-mono text-xs text-faint">
          {t(dict?.settings.algorithm, {
            name: patternAnalysis?.algorithm ?? "mania-interlude-v1",
          })}
        </p>
      }
      coverage={patternCoverage}
      progressPct={patternProgressPct}
      running={patternRunning}
      statusText={statusText}
      totalLabel={t(dict?.settings.maps7k, {
        count: patternTotal.toLocaleString(),
      })}
      startLabel={
        dict?.settings.calculateMissingPatterns ?? "Calculate missing patterns"
      }
      startRunningLabel={
        patternRunning && patternAnalysis?.mode !== "recompute"
          ? dict?.settings.calculating ?? "Calculating…"
          : dict?.settings.calculateMissingPatterns ??
            "Calculate missing patterns"
      }
      startPending={startPattern.isPending || recomputePattern.isPending}
      onStart={() => startPattern.mutate()}
      extraActions={
        <button
          type="button"
          className="rx-btn"
          disabled={
            patternRunning ||
            startPattern.isPending ||
            recomputePattern.isPending ||
            patternTotal === 0
          }
          onClick={() => recomputePattern.mutate()}
        >
          {patternRunning && patternAnalysis?.mode === "recompute"
            ? dict?.settings.recalculatingPatterns ?? "Recalculating…"
            : dict?.settings.recalculateAllPatterns ??
              "Recalculate all patterns"}
        </button>
      }
      stopPending={stopPattern.isPending}
      stopStatusLabel={
        patternAnalysis?.status === "stopping"
          ? dict?.settings.stopping ?? "Stopping…"
          : dict?.settings.stop ?? "Stop"
      }
      onStop={() => stopPattern.mutate()}
      startError={startPattern.error?.message}
      stopError={stopPattern.error?.message}
      jobError={patternAnalysis?.error}
    />
  );
}
