import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSunnyDanJob,
  startSunnyDanJob,
  stopSunnyDanJob,
  type SettingsPayload,
} from "../../../lib/api";
import { statusLabel } from "../../../lib/settingsLabels";
import { useAppDict, t } from "../../../lib/i18n";
import { JobRunnerSection } from "./JobRunnerSection";

export function SunnyDanSection({ data }: { data: SettingsPayload }) {
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const sunnyDanQuery = useQuery({
    queryKey: ["settings", "sunny-dan"],
    queryFn: fetchSunnyDanJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const startDan = useMutation({
    mutationFn: startSunnyDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "sunny-dan"], state);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const stopDan = useMutation({
    mutationFn: stopSunnyDanJob,
    onSuccess: (state) => {
      queryClient.setQueryData(["settings", "sunny-dan"], state);
    },
  });

  const sunnyDan = sunnyDanQuery.data ?? data.sunnyDan;
  const coverage = sunnyDan?.coverage;
  const running =
    sunnyDan?.status === "running" || sunnyDan?.status === "stopping";
  const progressPct =
    coverage && coverage.maniaTotal > 0
      ? Math.min(
          100,
          Math.round((coverage.computed / coverage.maniaTotal) * 100),
        )
      : 0;

  const statusText = (
    <>
      {statusLabel(dict, sunnyDan?.status)}
      {running
        ? ` · ${t(dict?.settings.labeledThisRun, {
            count: sunnyDan.computedThisRun.toLocaleString(),
          })}`
        : null}
      {sunnyDan?.status === "completed" && sunnyDan.computedThisRun > 0
        ? ` · ${t(dict?.settings.labeled, {
            count: sunnyDan.computedThisRun.toLocaleString(),
          })}`
        : null}
      {coverage && coverage.failed > 0 && !running
        ? ` · ${t(dict?.settings.unparsableSkipped, {
            count: coverage.failed.toLocaleString(),
          })}`
        : null}
    </>
  );

  return (
    <JobRunnerSection
      sectionId="sunny-dan-calculation"
      title={dict?.settings.sunnyDan ?? "Sunny dan calculation"}
      desc={dict?.settings.sunnyDanDesc ?? "Compute Sunny dan labels for mania maps."}
      coverage={coverage}
      progressPct={progressPct}
      running={running}
      statusText={statusText}
      totalLabel={t(dict?.settings.maniaMaps, {
        count: coverage?.maniaTotal.toLocaleString() ?? "0",
      })}
      startLabel={dict?.settings.calculateMissingDans ?? "Calculate missing dans"}
      startRunningLabel={dict?.settings.calculating ?? "Calculating…"}
      startPending={startDan.isPending}
      onStart={() => startDan.mutate()}
      stopPending={stopDan.isPending}
      stopStatusLabel={
        sunnyDan?.status === "stopping"
          ? dict?.settings.stopping ?? "Stopping…"
          : dict?.settings.stop ?? "Stop"
      }
      onStop={() => stopDan.mutate()}
      startError={startDan.error?.message}
      stopError={stopDan.error?.message}
      jobError={sunnyDan?.error}
    />
  );
}
