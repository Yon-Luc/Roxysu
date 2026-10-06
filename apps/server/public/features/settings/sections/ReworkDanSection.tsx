import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchReworkDanJob,
  relabelReworkDanJob,
  startReworkDanJob,
  stopReworkDanJob,
  type SettingsPayload,
} from "../../../lib/api";
import { statusLabel } from "../../../lib/settingsLabels";
import { useAppDict, t } from "../../../lib/i18n";
import { JobRunnerSection } from "./JobRunnerSection";

export function ReworkDanSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const reworkDanQuery = useQuery({
    queryKey: ["settings", "rework-dan"],
    queryFn: fetchReworkDanJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const startRework = useMutation({
    mutationFn: startReworkDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "rework-dan"], state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const stopRework = useMutation({
    mutationFn: stopReworkDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "rework-dan"], state);
    },
  });

  const relabelRework = useMutation({
    mutationFn: relabelReworkDanJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const reworkDan = reworkDanQuery.data ?? data.reworkDan;
  const coverage = reworkDan?.coverage;
  const running =
    reworkDan?.status === "running" || reworkDan?.status === "stopping";
  const progressPct =
    coverage && coverage.maniaTotal > 0
      ? Math.min(100, Math.round((coverage.computed / coverage.maniaTotal) * 100))
      : 0;

  const statusText = (
    <>
      {statusLabel(dict, reworkDan?.status)}
      {running
        ? ` · ${t(dict?.settings.labeledThisRun, {
            count: reworkDan.computedThisRun.toLocaleString(),
          })}`
        : null}
      {reworkDan?.status === "completed" && reworkDan.computedThisRun > 0
        ? ` · ${t(dict?.settings.labeled, {
            count: reworkDan.computedThisRun.toLocaleString(),
          })}`
        : null}
      {reworkDan?.relabeledThisRun ? (
        <span className="ml-2 text-faint">
          {dict?.settings.reworkDanRelabeled ??
            `${reworkDan.relabeledThisRun.toLocaleString()} relabeled from dans.json`}
        </span>
      ) : null}
    </>
  );

  return (
    <JobRunnerSection
      sectionId="rework-dan-calculation"
      title={dict?.settings.reworkDan ?? "Rework dan calculation"}
      desc={
        dict?.settings.reworkDanDesc ??
        "Compute mania difficulty port stars and dan tiers for every mania key mode. Tiers come from packages/mania-difficulty/dans.json."
      }
      coverage={coverage}
      progressPct={progressPct}
      running={running}
      statusText={statusText}
      totalLabel={
        t(dict?.settings.maniaMaps, {
          count: coverage?.maniaTotal.toLocaleString() ?? "0",
        }) ??
        `${(coverage?.maniaTotal.toLocaleString() ?? "0")} mania maps`
      }
      startLabel={dict?.settings.calculateMissingDans ?? "Calculate missing dans"}
      startRunningLabel={dict?.settings.calculating ?? "Calculating…"}
      startPending={startRework.isPending}
      onStart={() => startRework.mutate()}
      stopPending={stopRework.isPending}
      stopStatusLabel={
        reworkDan?.status === "stopping"
          ? dict?.settings.stopping ?? "Stopping…"
          : dict?.settings.stop ?? "Stop"
      }
      onStop={() => stopRework.mutate()}
      startError={startRework.error?.message}
      stopError={stopRework.error?.message}
      jobError={reworkDan?.error}
      extraActions={
        <button
          type="button"
          className="rx-btn"
          disabled={running || relabelRework.isPending}
          onClick={() => relabelRework.mutate()}
          title={dict?.settings.reworkDanRelabelHint}
        >
          {dict?.settings.reworkDanRelabel ?? "Relabel from dans.json"}
        </button>
      }
    />
  );
}