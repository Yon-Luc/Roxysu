import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { KeybindModal } from "./KeybindModal";
import { PageTitle } from "../../components/PageTitle";
import {
  fetchSettings,
  fetchPatternAnalysisJob,
  fetchRatingLabJob,
  fetchSunnyDanJob,
  patchSettings,
  startPatternAnalysisJob,
  startRatingLabJob,
  startSunnyDanJob,
  stopPatternAnalysisJob,
  stopRatingLabJob,
  stopSunnyDanJob,
} from "../../lib/api";
import { isDesktopShell } from "../../lib/desktop";
import {
  pageSectionDomId,
  useScrollToPageSection,
} from "../../lib/pageSections";
import {
  ratingDisplayOptions,
  setRatingDisplayMode,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import {
  setTheme,
  themeOptions,
  useTheme,
} from "../../lib/theme";

export function SettingsPage({ section }: { section?: string } = {}) {
  const desktop = isDesktopShell();
  const queryClient = useQueryClient();
  const ratingMode = useRatingDisplayMode();
  const themeMode = useTheme();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  useScrollToPageSection(section, { ready: !isLoading && !!data });

  const [osuPathDraft, setOsuPathDraft] = useState("");
  const [tosuHostDraft, setTosuHostDraft] = useState("");
  const [tosuExeDraft, setTosuExeDraft] = useState("");
  const [keybindOpen, setKeybindOpen] = useState(false);
  const [maniaExeDrafts, setManiaExeDrafts] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (data?.paths) {
      setOsuPathDraft(data.paths.osuDataPath ?? "");
    }
    if (data?.tosu) {
      setTosuHostDraft(data.tosu.host);
      setTosuExeDraft(data.tosu.executablePath ?? "");
    }
    if (data?.maniaRating?.versions) {
      const next: Record<string, string> = {};
      for (const v of data.maniaRating.versions) {
        next[v.id] = v.executablePath ?? "";
      }
      setManiaExeDrafts(next);
    }
  }, [data?.paths, data?.tosu, data?.maniaRating?.versions]);

  const sunnyDanQuery = useQuery({
    queryKey: ["settings", "sunny-dan"],
    queryFn: fetchSunnyDanJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const patternAnalysisQuery = useQuery({
    queryKey: ["settings", "pattern-analysis"],
    queryFn: fetchPatternAnalysisJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const ratingLabJobQuery = useQuery({
    queryKey: ["rating-lab", "job"],
    queryFn: fetchRatingLabJob,
    enabled: !desktop,
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

  const scoresUsernameMut = useMutation({
    mutationFn: (scoresUsernameFilter: string | string[]) =>
      patchSettings({ scoresUsernameFilter }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
    },
  });

  const pathMut = useMutation({
    mutationFn: (osuDataPath: string | null) => patchSettings({ osuDataPath }),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      setOsuPathDraft(next.paths.osuDataPath ?? "");
    },
  });

  const tosuMut = useMutation({
    mutationFn: (body: {
      tosuEnabled?: boolean;
      tosuHost?: string;
      tosuExecutablePath?: string | null;
    }) => patchSettings(body),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      if (next.tosu) {
        setTosuHostDraft(next.tosu.host);
        setTosuExeDraft(next.tosu.executablePath ?? "");
      }
      void queryClient.invalidateQueries({ queryKey: ["tosu", "live"] });
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

  const startPattern = useMutation({
    mutationFn: startPatternAnalysisJob,
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

  const maniaRatingMut = useMutation({
    mutationFn: (executables: Record<string, string | null>) =>
      patchSettings({ maniaRatingExecutables: executables }),
    onSuccess: (next) => {
      if ("error" in next) return;
      queryClient.setQueryData(["settings"], next);
      if (next.maniaRating?.versions) {
        const drafts: Record<string, string> = {};
        for (const v of next.maniaRating.versions) {
          drafts[v.id] = v.executablePath ?? "";
        }
        setManiaExeDrafts(drafts);
      }
    },
  });

  const startRatingLab = useMutation({
    mutationFn: (versionId: string) =>
      startRatingLabJob({ versionId, query: "mode:mania" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "job"] });
    },
  });

  const stopRatingLab = useMutation({
    mutationFn: stopRatingLabJob,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "job"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeaderSkeleton subtitleWidth="w-[32rem]" />
        <section className="rx-panel p-5">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="mt-2 h-4 w-full max-w-[36rem]" />
          <SkeletonBlock className="mt-1 h-4 w-full max-w-[30rem]" />
          <SkeletonBlock className="mt-5 h-3 w-24" />
          <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
          <div className="mt-4 flex gap-2">
            <SkeletonBlock className="h-10 w-28 rounded-xl" />
            <SkeletonBlock className="h-10 w-32 rounded-xl" />
          </div>
        </section>
        <section className="rx-panel p-5">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="mt-2 h-4 w-full max-w-[34rem]" />
          <div className="mt-4 space-y-4">
            <PanelSkeleton lines={2} className="p-4" />
            <div>
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
            </div>
            <div>
              <SkeletonBlock className="h-3 w-28" />
              <SkeletonBlock className="mt-2 h-11 w-full rounded-xl" />
            </div>
          </div>
        </section>
        <PanelSkeleton lines={4} />
        <PanelSkeleton lines={4} />
        <PanelSkeleton lines={4} />
      </div>
    );
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

  const patternAnalysis = patternAnalysisQuery.data ?? data.patternAnalysis;
  const patternCoverage = patternAnalysis?.coverage;
  const patternRunning =
    patternAnalysis?.status === "running" ||
    patternAnalysis?.status === "stopping";
  const patternProgressPct =
    patternCoverage && patternCoverage.total7k > 0
      ? Math.min(
          100,
          Math.round(
            (patternCoverage.computed / patternCoverage.total7k) * 100,
          ),
        )
      : 0;

  const paths = data.paths;
  const pathDirty =
    (osuPathDraft.trim() || null) !== (paths.osuDataPath ?? null);
  const tosu = data.tosu;
  const tosuHostDirty = tosuHostDraft.trim() !== tosu.host;
  const tosuExeDirty =
    (tosuExeDraft.trim() || null) !== (tosu.executablePath ?? null);

  const maniaRating = data.maniaRating;
  const maniaVersions = maniaRating?.versions ?? [];
  const maniaJob = ratingLabJobQuery.data ?? maniaRating?.job;
  const maniaCoverage = maniaJob?.coverage;
  const maniaRunning =
    maniaJob?.status === "running" || maniaJob?.status === "stopping";
  const maniaProgressPct =
    maniaCoverage && maniaCoverage.maniaTotal > 0
      ? Math.min(
          100,
          Math.round((maniaCoverage.computed / maniaCoverage.maniaTotal) * 100),
        )
      : 0;
  const defaultExperimentVersion =
    maniaVersions.find((v) => v.id === "enissay-accuracy-change")?.id ??
    maniaVersions[1]?.id ??
    maniaVersions[0]?.id ??
    "";

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="rx-subtitle">
          Display preferences and tools — mastery formulas recompute all levels
          when changed.
        </p>
      </div>

      <section
        id={pageSectionDomId("osu-lazer-data-folder")}
        className="rx-panel scroll-mt-6 p-5"
      >
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

      <section
        id={pageSectionDomId("tosu-live-map")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Tosu / live map</h2>
        <p className="mt-1 text-sm text-muted">
          Connect to a local{" "}
          <span className="font-mono">tosu</span> WebSocket for the currently
          selected osu! map on the live session page. Analysis uses Roxysu Sunny
          / 7K patterns (not Etterna MSD).
        </p>

        <label className="mt-4 flex cursor-pointer gap-3 rounded-xl bg-elevated/50 px-4 py-3">
          <input
            type="checkbox"
            checked={tosu.enabled}
            disabled={tosuMut.isPending}
            onChange={(e) => tosuMut.mutate({ tosuEnabled: e.target.checked })}
            className="mt-1 accent-[var(--color-accent)]"
          />
          <div>
            <div className="font-bold text-ink">Enable tosu live adapter</div>
            <div className="mt-0.5 text-sm text-muted">
              When on, Roxysu connects to{" "}
              <span className="font-mono">ws://…/websocket/v2</span> and can
              auto-start tosu if the executable path is set.
            </div>
          </div>
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Host
          </span>
          <input
            type="text"
            value={tosuHostDraft}
            onChange={(e) => setTosuHostDraft(e.target.value)}
            placeholder={tosu.defaultHost}
            disabled={tosuMut.isPending}
            className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Executable path
          </span>
          <input
            type="text"
            value={tosuExeDraft}
            onChange={(e) => setTosuExeDraft(e.target.value)}
            placeholder="/path/to/tosu"
            disabled={tosuMut.isPending}
            className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn-primary"
            disabled={
              tosuMut.isPending || (!tosuHostDirty && !tosuExeDirty)
            }
            onClick={() =>
              tosuMut.mutate({
                ...(tosuHostDirty
                  ? { tosuHost: tosuHostDraft.trim() || tosu.defaultHost }
                  : {}),
                ...(tosuExeDirty
                  ? {
                      tosuExecutablePath: tosuExeDraft.trim()
                        ? tosuExeDraft.trim()
                        : null,
                    }
                  : {}),
              })
            }
          >
            {tosuMut.isPending ? "Saving…" : "Save tosu settings"}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={tosuMut.isPending || tosu.executablePath == null}
            onClick={() => tosuMut.mutate({ tosuExecutablePath: null })}
          >
            Clear executable
          </button>
        </div>

        {tosuMut.error ? (
          <p className="mt-3 text-sm text-rose-300">{tosuMut.error.message}</p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("mastery-formula")}
        className="rx-panel scroll-mt-6 p-5"
      >
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

      <section
        id={pageSectionDomId("score-username")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Score username</h2>
        <p className="mt-1 text-sm text-muted">
          Hide scores from downloaded replays by default. Auto uses the username
          that appears most often; otherwise pick one or more usernames.
        </p>
        {data.scores ? (
          <>
            <div className="mt-4 space-y-2">
              <label
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  data.scores.mode === "auto"
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="scoresUsernameMode"
                  checked={data.scores.mode === "auto"}
                  disabled={scoresUsernameMut.isPending}
                  onChange={() => scoresUsernameMut.mutate("auto")}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">Auto</div>
                  <div className="mt-0.5 text-sm text-muted">
                    Most common username
                    {data.scores.mostCommonUsername
                      ? ` (${data.scores.mostCommonUsername})`
                      : ""}
                  </div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  data.scores.mode === "all"
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="scoresUsernameMode"
                  checked={data.scores.mode === "all"}
                  disabled={scoresUsernameMut.isPending}
                  onChange={() => scoresUsernameMut.mutate("*")}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">All usernames</div>
                  <div className="mt-0.5 text-sm text-muted">
                    Include scores from downloaded replays and every player.
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                Selected usernames
              </div>
              {data.scores.usernames.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  No usernames found on scores yet — sync some plays first.
                </p>
              ) : (
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-elevated/40 p-2">
                  {data.scores.usernames.map((u) => {
                    const checked =
                      data.scores.mode === "selected" &&
                      data.scores.selectedUsernames.includes(u.username);
                    return (
                      <label
                        key={u.username}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition ${
                          checked
                            ? "bg-accent-glow ring-1 ring-accent/40"
                            : "hover:bg-elevated"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={scoresUsernameMut.isPending}
                          onChange={() => {
                            const current =
                              data.scores.mode === "selected"
                                ? data.scores.selectedUsernames
                                : [];
                            const next = checked
                              ? current.filter((name) => name !== u.username)
                              : [...current, u.username];
                            if (next.length === 0) {
                              scoresUsernameMut.mutate("auto");
                              return;
                            }
                            scoresUsernameMut.mutate(next);
                          }}
                          className="accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">
                          {u.username}
                        </span>
                        <span className="font-mono text-xs text-faint">
                          {u.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {data.scores.mode === "auto" &&
            data.scores.resolvedUsernames &&
            data.scores.resolvedUsernames.length > 0 ? (
              <p className="mt-2 text-sm text-muted">
                Currently filtering to{" "}
                <span className="font-semibold text-ink">
                  {data.scores.resolvedUsernames.join(", ")}
                </span>
                .
              </p>
            ) : null}
            {data.scores.mode === "selected" &&
            data.scores.selectedUsernames.length > 0 ? (
              <p className="mt-2 text-sm text-muted">
                Showing{" "}
                <span className="font-semibold text-ink">
                  {data.scores.selectedUsernames.join(", ")}
                </span>
                .
              </p>
            ) : null}
          </>
        ) : null}
        {scoresUsernameMut.isPending ? (
          <p className="mt-3 text-sm text-muted">
            Updating filter and recomputing analytics…
          </p>
        ) : null}
        {scoresUsernameMut.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {scoresUsernameMut.error.message}
          </p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("live-sync")}
        className="rx-panel scroll-mt-6 p-5"
      >
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

      <section
        id={pageSectionDomId("appearance")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Appearance</h2>
        <p className="mt-1 text-sm text-muted">
          Choose a light or dark interface. System follows your OS preference.
        </p>
        <div className="mt-4 space-y-2">
          {themeOptions().map((opt) => {
            const active = opt.id === themeMode;
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
                  name="theme"
                  checked={active}
                  onChange={() => setTheme(opt.id)}
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

      <section
        id={pageSectionDomId("difficulty-display")}
        className="rx-panel scroll-mt-6 p-5"
      >
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

      <section
        id={pageSectionDomId("preview-skin")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Preview skin</h2>
        <p className="mt-1 text-sm text-muted">
          Customize note shape, colors, size, hit position, and lane cover for
          4K–10K previews.
        </p>
        <Link to="/skin" className="rx-btn-primary mt-4 inline-flex">
          Open skin editor
        </Link>
      </section>

      <section
        id={pageSectionDomId("keybinds")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Keybinds</h2>
        <p className="mt-1 text-sm text-muted">
          Choose keys per column for each keymode when testing maps in preview
          Play mode.
        </p>
        <button
          type="button"
          className="rx-btn-primary mt-4"
          onClick={() => setKeybindOpen(true)}
        >
          Edit keybinds
        </button>
        <KeybindModal
          open={keybindOpen}
          onClose={() => setKeybindOpen(false)}
        />
      </section>

      {!desktop ? (
      <section
        id={pageSectionDomId("mania-rating-lab")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">Mania Rating Lab</h2>
        <p className="mt-1 text-sm text-muted">
          Calculator binaries built from osu!lazer branches (see{" "}
          <code className="text-xs">docs/mania-rating-lab.md</code>). Used by
          the{" "}
          <Link to="/rating-lab" className="text-accent hover:underline">
            Rating Lab
          </Link>{" "}
          page to compare SR and SS PP.
        </p>

        <div className="mt-4 space-y-4">
          {maniaVersions.map((version) => {
            const draft = maniaExeDrafts[version.id] ?? "";
            const saved = version.executablePath ?? "";
            const dirty = (draft.trim() || null) !== (saved || null);
            const optional = version.usesImport === true;
            return (
              <label key={version.id} className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {version.label}
                  {optional ? " (optional)" : ""}
                </span>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) =>
                    setManiaExeDrafts((prev) => ({
                      ...prev,
                      [version.id]: e.target.value,
                    }))
                  }
                  placeholder={
                    optional
                      ? "Optional — SS PP max only"
                      : `/path/to/mania-rating-calc (${version.id})`
                  }
                  disabled={maniaRatingMut.isPending}
                  className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-faint">{version.description}</p>
                {dirty ? (
                  <button
                    type="button"
                    className="rx-btn mt-2"
                    disabled={maniaRatingMut.isPending}
                    onClick={() =>
                      maniaRatingMut.mutate({
                        [version.id]: draft.trim() ? draft.trim() : null,
                      })
                    }
                  >
                    Save {version.label}
                  </button>
                ) : null}
              </label>
            );
          })}
        </div>

        {maniaCoverage ? (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {maniaCoverage.computed.toLocaleString()}
                </span>
                {" / "}
                {maniaCoverage.maniaTotal.toLocaleString()} mania maps
                {maniaJob?.versionId ? ` (${maniaJob.versionId})` : ""}
              </span>
              <span>{maniaCoverage.missing.toLocaleString()} remaining</span>
              {maniaCoverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {maniaCoverage.failed.toLocaleString()} failed
                </span>
              ) : null}
            </div>

            <div className="h-2 overflow-hidden rounded bg-elevated">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${maniaProgressPct}%` }}
              />
            </div>

            <p className="text-xs text-faint">
              {statusLabel(maniaJob?.status)}
              {maniaRunning
                ? ` · +${maniaJob?.computedThisRun.toLocaleString() ?? 0} computed this run`
                : null}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rx-btn-primary"
            disabled={
              maniaRunning ||
              startRatingLab.isPending ||
              !defaultExperimentVersion ||
              (maniaCoverage?.missing ?? 0) === 0
            }
            onClick={() => startRatingLab.mutate(defaultExperimentVersion)}
          >
            {maniaRunning ? "Computing…" : "Backfill experiment ratings"}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!maniaRunning || stopRatingLab.isPending}
            onClick={() => stopRatingLab.mutate()}
          >
            {maniaJob?.status === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </div>

        {maniaRatingMut.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {maniaRatingMut.error.message}
          </p>
        ) : null}
        {maniaJob?.error ? (
          <p className="mt-3 text-sm text-rose-300">{maniaJob.error}</p>
        ) : null}
      </section>
      ) : null}

      <section
        id={pageSectionDomId("sunny-dan-calculation")}
        className="rx-panel scroll-mt-6 p-5"
      >
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

      <section
        id={pageSectionDomId("pattern-analysis")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">7K pattern analysis</h2>
        <p className="mt-1 text-sm text-muted">
          Classify 7K mania maps with the structural pattern algorithm (delay,
          chordjack, bracket, etc.) for pattern filters and the practice browser.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">
          Algorithm: {patternAnalysis?.algorithm ?? "7k-structural-v2"}
        </p>

        {patternCoverage ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {patternCoverage.computed.toLocaleString()}
                </span>
                {" / "}
                {patternCoverage.total7k.toLocaleString()} 7K maps
              </span>
              <span>{patternCoverage.missing.toLocaleString()} remaining</span>
              {patternCoverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {patternCoverage.failed.toLocaleString()} failed
                </span>
              ) : null}
            </div>

            <div className="h-2 overflow-hidden rounded bg-elevated">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${patternProgressPct}%` }}
              />
            </div>

            <p className="text-xs text-faint">
              {statusLabel(patternAnalysis?.status)}
              {patternRunning
                ? ` · +${patternAnalysis.computedThisRun.toLocaleString()} classified this run`
                : null}
              {patternAnalysis?.status === "completed" &&
              patternAnalysis.computedThisRun > 0
                ? ` · +${patternAnalysis.computedThisRun.toLocaleString()} classified`
                : null}
              {patternCoverage.failed > 0 && !patternRunning
                ? ` · ${patternCoverage.failed.toLocaleString()} unparsable skipped`
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
              patternRunning ||
              startPattern.isPending ||
              (patternCoverage?.missing ?? 0) === 0
            }
            onClick={() => startPattern.mutate()}
          >
            {patternRunning ? "Calculating…" : "Calculate missing patterns"}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!patternRunning || stopPattern.isPending}
            onClick={() => stopPattern.mutate()}
          >
            {patternAnalysis?.status === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </div>

        {startPattern.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {startPattern.error.message}
          </p>
        ) : null}
        {stopPattern.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {stopPattern.error.message}
          </p>
        ) : null}
        {patternAnalysis?.error ? (
          <p className="mt-3 text-sm text-rose-300">{patternAnalysis.error}</p>
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
