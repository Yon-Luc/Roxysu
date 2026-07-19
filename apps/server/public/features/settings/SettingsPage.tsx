import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageTitle } from "../../components/PageTitle";
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

  const [osuPathDraft, setOsuPathDraft] = useState("");

  useEffect(() => {
    if (data?.paths) {
      setOsuPathDraft(data.paths.osuDataPath ?? "");
    }
  }, [data?.paths]);

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

  const syncMut = useMutation({
    mutationFn: (pauseWhenUnfocused: boolean) =>
      patchSettings({ pauseWhenUnfocused }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["system", "status"] });
    },
  });

  const pathMut = useMutation({
    mutationFn: (osuDataPath: string | null) => patchSettings({ osuDataPath }),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      setOsuPathDraft(next.paths.osuDataPath ?? "");
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

  const paths = data.paths;
  const pathDirty =
    (osuPathDraft.trim() || null) !== (paths.osuDataPath ?? null);

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="rx-subtitle">
          Display preferences and tools — mastery formulas recompute all levels
          when changed.
        </p>
      </div>

      <section className="rx-panel p-5">
        <h2 className="text-sm font-bold text-ink">osu!lazer data folder</h2>
        <p className="mt-1 text-sm text-muted">
          Folder that contains <span className="font-mono">client.realm</span>{" "}
          and <span className="font-mono">files/</span>. Override when the
          default path is wrong (Flatpak, custom install, etc.).
        </p>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Custom path
          </span>
          <input
            type="text"
            value={osuPathDraft}
            onChange={(e) => setOsuPathDraft(e.target.value)}
            placeholder={paths.resolvedOsuDataPath}
            disabled={pathMut.isPending || paths.source === "env"}
            className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <div className="mt-3 space-y-1 text-sm text-muted">
          <p>
            Using{" "}
            <span className="font-mono text-ink">
              {paths.resolvedOsuDataPath}
            </span>{" "}
            ({pathSourceLabel(paths.source)})
          </p>
          <p className="font-mono text-xs text-faint">
            realm → {paths.resolvedRealmPath}
          </p>
          <p className="text-xs">{pathStatusLabel(paths.status)}</p>
          {paths.source === "env" ? (
            <p className="text-xs text-amber-200/90">
              <span className="font-mono">OSU_DATA_PATH</span> or{" "}
              <span className="font-mono">REALM_PATH</span> is set — env wins
              over this setting.
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn-primary"
            disabled={
              pathMut.isPending ||
              paths.source === "env" ||
              !pathDirty ||
              !osuPathDraft.trim()
            }
            onClick={() => pathMut.mutate(osuPathDraft.trim())}
          >
            {pathMut.isPending ? "Saving…" : "Save path"}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={
              pathMut.isPending ||
              paths.source === "env" ||
              paths.osuDataPath == null
            }
            onClick={() => pathMut.mutate(null)}
          >
            Clear override
          </button>
        </div>

        {pathMut.error ? (
          <p className="mt-3 text-sm text-rose-300">{pathMut.error.message}</p>
        ) : null}
      </section>

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
        <h2 className="text-sm font-bold text-ink">Live sync</h2>
        <p className="mt-1 text-sm text-muted">
          Optionally pause Realm imports while Roxysu is unfocused so lazer isn’t
          fighting for the file during score submission. Off by default.
        </p>
        <label className="mt-4 flex cursor-pointer gap-3 rounded-xl bg-elevated/50 px-4 py-3 hover:bg-elevated">
          <input
            type="checkbox"
            checked={data.sync.pauseWhenUnfocused}
            disabled={syncMut.isPending}
            onChange={(e) => syncMut.mutate(e.target.checked)}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <div className="font-bold text-ink">
              Pause sync when Roxysu is unfocused
            </div>
            <div className="mt-0.5 text-sm text-muted">
              When enabled, imports resume after you focus this window again.
            </div>
          </div>
        </label>
        {syncMut.error ? (
          <p className="mt-3 text-sm text-rose-300">{syncMut.error.message}</p>
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
        <h2 className="text-sm font-bold text-ink">Preview skin</h2>
        <p className="mt-1 text-sm text-muted">
          Customize note shape, colors, and size per column for 4K–10K previews.
        </p>
        <Link to="/skin" className="rx-btn-primary mt-4 inline-flex">
          Open skin editor
        </Link>
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
                ? ` · +${sunnyDan.computedThisRun.toLocaleString()} labeled this run`
                : null}
              {sunnyDan.status === "completed" && sunnyDan.computedThisRun > 0
                ? ` · +${sunnyDan.computedThisRun.toLocaleString()} labeled`
                : null}
              {coverage && coverage.failed > 0 && !running
                ? ` · ${coverage.failed.toLocaleString()} unparsable skipped`
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

function pathSourceLabel(source: string): string {
  switch (source) {
    case "env":
      return "from environment";
    case "settings":
      return "from settings";
    default:
      return "default";
  }
}

function pathStatusLabel(status: {
  exists: boolean;
  hasRealm: boolean;
  hasFiles: boolean;
}): string {
  if (!status.exists) return "Directory not found";
  const bits = [
    status.hasRealm ? "client.realm found" : "client.realm missing",
    status.hasFiles ? "files/ found" : "files/ missing",
  ];
  return bits.join(" · ");
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
