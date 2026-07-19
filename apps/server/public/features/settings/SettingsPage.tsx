import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSettings,
  fetchSunnyDanJob,
  patchSettings,
  startSunnyDanJob,
  stopSunnyDanJob,
} from "../../lib/api";
import {
  ratingDisplayOptions,
  setRatingDisplayMode,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const ratingMode = useRatingDisplayMode();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const sunnyDanQuery = useQuery({
    queryKey: ["settings", "sunny-dan"],
    queryFn: fetchSunnyDanJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const mut = useMutation({
    mutationFn: (masteryFormulaId: string) =>
      patchSettings({ masteryFormulaId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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

  if (isLoading) {
    return <p className="text-muted">Loading settings…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load settings: {error?.message ?? "unknown"}
      </p>
    );
  }

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="rx-title">Settings</h1>
        <p className="rx-subtitle">
          Display preferences and tools — mastery formulas recompute all levels
          when changed.
        </p>
      </div>

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">Mastery formula</h2>
        <div className="mt-4 space-y-2">
          {data.mastery.formulas.map((f) => {
            const active = f.id === data.mastery.formulaId;
            return (
              <label
                key={f.id}
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  active
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="masteryFormula"
                  checked={active}
                  disabled={mut.isPending}
                  onChange={() => mut.mutate(f.id)}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">{f.label}</div>
                  <div className="mt-0.5 text-sm text-muted">{f.description}</div>
                  <div className="mt-1 font-mono text-xs text-faint">
                    id: {f.id}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {mut.isPending ? (
          <p className="mt-3 text-sm text-muted">Recomputing mastery…</p>
        ) : null}
        {mut.error ? (
          <p className="mt-3 text-sm text-rose-300">{mut.error.message}</p>
        ) : null}
      </section>

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">Difficulty display</h2>
        <p className="mt-1 text-sm text-muted">
          Choose what appears in place of star rating across the app. Falls back
          to osu! stars when Sunny data is missing.
        </p>
        <div className="mt-4 space-y-2">
          {ratingDisplayOptions().map((opt) => {
            const active = opt.id === ratingMode;
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  active
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="ratingDisplay"
                  checked={active}
                  onChange={() => setRatingDisplayMode(opt.id)}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">{opt.label}</div>
                  <div className="mt-0.5 text-sm text-muted">
                    {opt.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">Sunny dan calculation</h2>
        <p className="mt-1 text-sm text-muted">
          Compute Sunny dan labels for mania maps that are still missing a
          rating. Runs in the background in small batches.
        </p>

        {coverage ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {coverage.computed.toLocaleString()}
                </span>
                {" / "}
                {coverage.maniaTotal.toLocaleString()} mania maps
              </span>
              <span>{coverage.missing.toLocaleString()} remaining</span>
              {coverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {coverage.failed.toLocaleString()} failed
                </span>
              ) : null}
            </div>

            <div className="h-2 overflow-hidden rounded bg-elevated">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <p className="text-xs text-faint">
              {statusLabel(sunnyDan.status)}
              {running
                ? ` · ${sunnyDan.computedThisRun.toLocaleString()} this run`
                : null}
              {sunnyDan.status === "completed" && sunnyDan.computedThisRun > 0
                ? ` · ${sunnyDan.computedThisRun.toLocaleString()} computed`
                : null}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Loading coverage…</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn-primary"
            disabled={
              running ||
              startDan.isPending ||
              (coverage?.missing ?? 0) === 0
            }
            onClick={() => startDan.mutate()}
          >
            {running ? "Calculating…" : "Calculate missing dans"}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!running || stopDan.isPending}
            onClick={() => stopDan.mutate()}
          >
            {sunnyDan?.status === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </div>

        {startDan.error ? (
          <p className="mt-3 text-sm text-rose-300">{startDan.error.message}</p>
        ) : null}
        {stopDan.error ? (
          <p className="mt-3 text-sm text-rose-300">{stopDan.error.message}</p>
        ) : null}
        {sunnyDan?.error ? (
          <p className="mt-3 text-sm text-rose-300">{sunnyDan.error}</p>
        ) : null}
      </section>
    </div>
  );
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "running":
      return "Running";
    case "stopping":
      return "Stopping after current batch";
    case "completed":
      return "Complete";
    case "error":
      return "Stopped with error";
    default:
      return "Idle";
  }
}
