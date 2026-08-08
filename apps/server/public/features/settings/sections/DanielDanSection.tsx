import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDanielDanJob,
  startDanielDanJob,
  stopDanielDanJob,
  type SettingsPayload,
} from "../../../lib/api";
import { statusLabel } from "../../../lib/settingsLabels";
import { useAppDict, t } from "../../../lib/i18n";
import { JobRunnerSection } from "./JobRunnerSection";

export function DanielDanSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const danielDanQuery = useQuery({
    queryKey: ["settings", "daniel-dan"],
    queryFn: fetchDanielDanJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const startDaniel = useMutation({
    mutationFn: startDanielDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "daniel-dan"], state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const stopDaniel = useMutation({
    mutationFn: stopDanielDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "daniel-dan"], state);
    },
  });

  const danielDan = danielDanQuery.data ?? data.danielDan;
  const danielCoverage = danielDan?.coverage;
  const danielRunning =
    danielDan?.status === "running" || danielDan?.status === "stopping";
  const danielProgressPct =
    danielCoverage && danielCoverage.fourKTotal > 0
      ? Math.min(
          100,
          Math.round((danielCoverage.computed / danielCoverage.fourKTotal) * 100),
        )
      : 0;

  const statusText = (
    <>
      {statusLabel(dict, danielDan?.status)}
      {danielRunning
        ? ` · ${t(dict?.settings.labeledThisRun, {
            count: danielDan.computedThisRun.toLocaleString(),
          })}`
        : null}
      {danielDan?.status === "completed" && danielDan.computedThisRun > 0
        ? ` · ${t(dict?.settings.labeled, {
            count: danielDan.computedThisRun.toLocaleString(),
          })}`
        : null}
    </>
  );

  return (
    <JobRunnerSection
      sectionId="daniel-dan-calculation"
      title={dict?.settings.danielDan ?? "Daniel dan calculation"}
      desc={
        dict?.settings.danielDanDesc ??
        "Compute Daniel dan labels for 4K mania maps still missing a rating. More accurate than Sunny for 4K RC."
      }
      coverage={danielCoverage}
      progressPct={danielProgressPct}
      running={danielRunning}
      statusText={statusText}
      totalLabel={
        t(dict?.settings.maps4k, {
          count: danielCoverage?.fourKTotal.toLocaleString() ?? "0",
        }) ??
        `${(danielCoverage?.fourKTotal.toLocaleString() ?? "0")} 4K maps`
      }
      startLabel={dict?.settings.calculateMissingDans ?? "Calculate missing dans"}
      startRunningLabel={dict?.settings.calculating ?? "Calculating…"}
      startPending={startDaniel.isPending}
      onStart={() => startDaniel.mutate()}
      stopPending={stopDaniel.isPending}
      stopStatusLabel={
        danielDan?.status === "stopping"
          ? dict?.settings.stopping ?? "Stopping…"
          : dict?.settings.stop ?? "Stop"
      }
      onStop={() => stopDaniel.mutate()}
      startError={startDaniel.error?.message}
      stopError={stopDaniel.error?.message}
      jobError={danielDan?.error}
    />
  );
}
