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
  fetchDanielDanJob,
  patchSettings,
  recomputePatternAnalysisJob,
  startPatternAnalysisJob,
  startRatingLabJob,
  startSunnyDanJob,
  startDanielDanJob,
  stopPatternAnalysisJob,
  stopRatingLabJob,
  stopSunnyDanJob,
  stopDanielDanJob,
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
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";

export function SettingsPage({ section }: { section?: string } = {}) {
  const desktop = isDesktopShell();
  const queryClient = useQueryClient();
  const ratingMode = useRatingDisplayMode();
  const themeMode = useTheme();
  const { dict } = useAppDict();
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

  const danielDanQuery = useQuery({
    queryKey: ["settings", "daniel-dan"],
    queryFn: fetchDanielDanJob,
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

  const scoresGamemodeMut = useMutation({
    mutationFn: (scoresGamemodeFilter: string) =>
      patchSettings({ scoresGamemodeFilter }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["practice"] });
      void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["recommend"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
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
        {t(dict?.settings.failedToLoad, {
          error: error?.message ?? "unknown",
        })}
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

  const danielDan = danielDanQuery.data ?? data.danielDan;
  const danielCoverage = danielDan?.coverage;
  const danielRunning =
    danielDan?.status === "running" || danielDan?.status === "stopping";
  const danielProgressPct =
    danielCoverage && danielCoverage.fourKTotal > 0
      ? Math.min(
          100,
          Math.round(
            (danielCoverage.computed / danielCoverage.fourKTotal) * 100,
          ),
        )
      : 0;

  const patternAnalysis = patternAnalysisQuery.data ?? data.patternAnalysis;
  const patternCoverage = patternAnalysis?.coverage;
  const patternRunning =
    patternAnalysis?.status === "running" ||
    patternAnalysis?.status === "stopping";
  const patternProgressPct =
    patternCoverage && (patternCoverage.totalMania ?? patternCoverage.total7k) > 0
      ? Math.min(
          100,
          Math.round(
            (patternCoverage.computed /
              (patternCoverage.totalMania ?? patternCoverage.total7k)) *
              100,
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
        <PageTitle>{dict?.settings.pageTitle ?? "Settings"}</PageTitle>
        <p className="rx-subtitle">{dict?.settings.subtitle}</p>
      </div>

      <section
        id={pageSectionDomId("osu-lazer-data-folder")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.lazerDataFolder}
        </h2>
        {dict?.settings.lazerDataFolderDesc ? (
          <p className="mt-1 text-sm text-muted">
            {dict.settings.lazerDataFolderDesc}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Folder that contains <span className="font-mono">client.realm</span>{" "}
            and <span className="font-mono">files/</span>. Override when the
            default path is wrong (Flatpak, custom install, etc.).
          </p>
        )}

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict?.settings.customPath}
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
            {(() => {
              const parts = t(dict?.settings.usingPath, {
                path: "⟦PATH⟧",
                source: pathSourceLabel(dict, paths.source),
              }).split("⟦PATH⟧");
              return (
                <>
                  {parts[0]}
                  <span className="font-mono text-ink">
                    {paths.resolvedOsuDataPath}
                  </span>
                  {parts[1]}
                </>
              );
            })()}
          </p>
          <p className="font-mono text-xs text-faint">
            realm → {paths.resolvedRealmPath}
          </p>
          <p className="text-xs">{pathStatusLabel(dict, paths.status)}</p>
          {paths.source === "env" ? (
            <p className="text-xs text-amber-200/90">
              <span className="font-mono">OSU_DATA_PATH</span> or{" "}
              <span className="font-mono">REALM_PATH</span> —{" "}
              {dict?.settings.envWins}
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
            {pathMut.isPending
              ? dict?.settings.saving
              : dict?.settings.savePath}
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
            {dict?.settings.clearOverride}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.tosuLiveMap}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.tosuLiveMapDesc}
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
            <div className="font-bold text-ink">
              {dict?.settings.enableTosu}
            </div>
            <div className="mt-0.5 text-sm text-muted">
              {dict?.settings.enableTosuDesc}
            </div>
          </div>
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict?.settings.host}
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
            {dict?.settings.executablePath}
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
            {tosuMut.isPending
              ? dict?.settings.saving
              : dict?.settings.saveTosu}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={tosuMut.isPending || tosu.executablePath == null}
            onClick={() => tosuMut.mutate({ tosuExecutablePath: null })}
          >
            {dict?.settings.clearExecutable}
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
                    {t(dict?.settings.idPrefix, { id: f.id })}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        {mut.isPending ? (
          <p className="mt-3 text-sm text-muted">
            {dict?.settings.recomputingMastery}
          </p>
        ) : null}
        {mut.error ? (
          <p className="mt-3 text-sm text-rose-300">{mut.error.message}</p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("score-username")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.scoreUsername}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.scoreUsernameDesc}
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
                  <div className="font-bold text-ink">
                    {dict?.settings.auto}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {dict?.settings.mostCommonUsername}
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
                  <div className="font-bold text-ink">
                    {dict?.settings.allUsernames}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {dict?.settings.allUsernamesDesc}
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">
                {dict?.settings.selectedUsernames}
              </div>
              {data.scores.usernames.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  {dict?.settings.noUsernames}
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
                {dict?.settings.currentlyFilteringTo}{" "}
                <span className="font-semibold text-ink">
                  {data.scores.resolvedUsernames.join(", ")}
                </span>
                .
              </p>
            ) : null}
            {data.scores.mode === "selected" &&
            data.scores.selectedUsernames.length > 0 ? (
              <p className="mt-2 text-sm text-muted">
                {dict?.settings.showing}{" "}
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
            {dict?.settings.updatingFilter}
          </p>
        ) : null}
        {scoresUsernameMut.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {scoresUsernameMut.error.message}
          </p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("gamemode")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.gamemode}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.gamemodeDesc}
        </p>
        {data.gamemode ? (
          <>
            <div className="mt-4 space-y-2">
              <label
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  data.gamemode.mode === "auto"
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="scoresGamemode"
                  checked={data.gamemode.mode === "auto"}
                  disabled={scoresGamemodeMut.isPending}
                  onChange={() => scoresGamemodeMut.mutate("auto")}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">
                    {dict?.settings.auto}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {dict?.settings.mostScores}
                    {data.gamemode.mostCommonGamemode
                      ? ` (${
                          data.gamemode.gamemodes.find(
                            (g) => g.id === data.gamemode.mostCommonGamemode,
                          )?.label ?? data.gamemode.mostCommonGamemode
                        })`
                      : ""}
                  </div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                  data.gamemode.mode === "all"
                    ? "bg-accent-glow ring-1 ring-accent/50"
                    : "bg-elevated/50 hover:bg-elevated"
                }`}
              >
                <input
                  type="radio"
                  name="scoresGamemode"
                  checked={data.gamemode.mode === "all"}
                  disabled={scoresGamemodeMut.isPending}
                  onChange={() => scoresGamemodeMut.mutate("*")}
                  className="mt-1 accent-[var(--color-accent)]"
                />
                <div>
                  <div className="font-bold text-ink">
                    {dict?.settings.allGamemodes}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {dict?.settings.allGamemodesDesc}
                  </div>
                </div>
              </label>
            </div>

            <div className="mt-4 space-y-2">
              {data.gamemode.gamemodes.map((g) => {
                const checked =
                  data.gamemode.mode === "selected" &&
                  data.gamemode.selectedGamemode === g.id;
                return (
                  <label
                    key={g.id}
                    className={`flex cursor-pointer gap-3 rounded-xl px-4 py-3 transition ${
                      checked
                        ? "bg-accent-glow ring-1 ring-accent/50"
                        : "bg-elevated/50 hover:bg-elevated"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scoresGamemode"
                      checked={checked}
                      disabled={scoresGamemodeMut.isPending}
                      onChange={() => scoresGamemodeMut.mutate(g.id)}
                      className="mt-1 accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-ink">
                        {g.label}{" "}
                        <span className="font-normal text-faint">
                          ({g.shortLabel})
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-faint">
                      {g.count}
                    </span>
                  </label>
                );
              })}
            </div>

            {data.gamemode.mode === "auto" && data.gamemode.resolvedGamemode ? (
              <p className="mt-2 text-sm text-muted">
                {dict?.settings.currentlyFilteringTo}{" "}
                <span className="font-semibold text-ink">
                  {data.gamemode.gamemodes.find(
                    (g) => g.id === data.gamemode.resolvedGamemode,
                  )?.label ?? data.gamemode.resolvedGamemode}
                </span>
                .
              </p>
            ) : null}
            {data.gamemode.mode === "selected" &&
            data.gamemode.selectedGamemode ? (
              <p className="mt-2 text-sm text-muted">
                {dict?.settings.showing}{" "}
                <span className="font-semibold text-ink">
                  {data.gamemode.gamemodes.find(
                    (g) => g.id === data.gamemode.selectedGamemode,
                  )?.label ?? data.gamemode.selectedGamemode}
                </span>{" "}
                {dict?.settings.onlySuffix}.
              </p>
            ) : null}
          </>
        ) : null}
        {scoresGamemodeMut.isPending ? (
          <p className="mt-3 text-sm text-muted">
            {dict?.settings.updatingFilter}
          </p>
        ) : null}
        {scoresGamemodeMut.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {scoresGamemodeMut.error.message}
          </p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("live-sync")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.liveSync}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.liveSyncDesc}
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
              {dict?.settings.pauseWhenUnfocused}
            </div>
            <div className="mt-0.5 text-sm text-muted">
              {dict?.settings.pauseWhenUnfocusedDesc}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.appearance}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.appearanceDesc}
        </p>
        <div className="mt-4 space-y-2">
          {themeOptions().map((opt) => {
            const active = opt.id === themeMode;
            const optDict = dict?.settings.theme[opt.id];
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
                  <div className="font-bold text-ink">
                    {optDict?.label ?? opt.label}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {optDict?.description ?? opt.description}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.difficultyDisplay}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.difficultyDisplayDesc}
        </p>
        <div className="mt-4 space-y-2">
          {ratingDisplayOptions().map((opt) => {
            const active = opt.id === ratingMode;
            const optDict = dict?.settings.ratingDisplay[opt.id];
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
                  <div className="font-bold text-ink">
                    {optDict?.label ?? opt.label}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {optDict?.description ?? opt.description}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.previewSkin}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.previewSkinDesc}
        </p>
        <Link to="/skin" className="rx-btn-primary mt-4 inline-flex">
          {dict?.settings.openSkinEditor}
        </Link>
      </section>

      <section
        id={pageSectionDomId("keybinds")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.keybinds}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.keybindsDesc}
        </p>
        <button
          type="button"
          className="rx-btn-primary mt-4"
          onClick={() => setKeybindOpen(true)}
        >
          {dict?.settings.editKeybinds}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.maniaRatingLab}
        </h2>
        {dict?.settings.maniaRatingLabDesc ? (
          <p className="mt-1 text-sm text-muted">
            {dict.settings.maniaRatingLabDesc}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Calculator binaries built from osu!lazer branches (see{" "}
            <code className="text-xs">docs/mania-rating-lab.md</code>). Used by
            the{" "}
            <Link to="/rating-lab" className="text-accent hover:underline">
              Rating Lab
            </Link>{" "}
            page to compare SR and SS PP.
          </p>
        )}

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
                  {optional
                    ? ` ${dict?.settings.optional ?? "(optional)"}`
                    : ""}
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
                      ? dict?.settings.optionalPlaceholder
                      : t(dict?.settings.calcPathPlaceholder, {
                          id: version.id,
                        })
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
                    {t(dict?.settings.saveLabel, { label: version.label })}
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
                {t(dict?.settings.maniaMaps, {
                  count: maniaCoverage.maniaTotal.toLocaleString(),
                })}
                {maniaJob?.versionId ? ` (${maniaJob.versionId})` : ""}
              </span>
              <span>
                {t(dict?.settings.remaining, {
                  count: maniaCoverage.missing.toLocaleString(),
                })}
              </span>
              {maniaCoverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {t(dict?.settings.failed, {
                    count: maniaCoverage.failed.toLocaleString(),
                  })}
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
              {statusLabel(dict, maniaJob?.status)}
              {maniaRunning
                ? ` · ${t(dict?.settings.computedThisRun, {
                    count:
                      maniaJob?.computedThisRun.toLocaleString() ?? "0",
                  })}`
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
            {maniaRunning
              ? dict?.settings.computing
              : dict?.settings.backfillRatings}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!maniaRunning || stopRatingLab.isPending}
            onClick={() => stopRatingLab.mutate()}
          >
            {maniaJob?.status === "stopping"
              ? dict?.settings.stopping
              : dict?.settings.stop}
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
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.sunnyDan}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.sunnyDanDesc}
        </p>

        {coverage ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {coverage.computed.toLocaleString()}
                </span>
                {" / "}
                {t(dict?.settings.maniaMaps, {
                  count: coverage.maniaTotal.toLocaleString(),
                })}
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

            <p className="text-xs text-faint">
              {statusLabel(dict, sunnyDan.status)}
              {running
                ? ` · ${t(dict?.settings.labeledThisRun, {
                    count: sunnyDan.computedThisRun.toLocaleString(),
                  })}`
                : null}
              {sunnyDan.status === "completed" && sunnyDan.computedThisRun > 0
                ? ` · ${t(dict?.settings.labeled, {
                    count: sunnyDan.computedThisRun.toLocaleString(),
                  })}`
                : null}
              {coverage && coverage.failed > 0 && !running
                ? ` · ${t(dict?.settings.unparsableSkipped, {
                    count: coverage.failed.toLocaleString(),
                  })}`
                : null}
            </p>
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
              running ||
              startDan.isPending ||
              (coverage?.missing ?? 0) === 0
            }
            onClick={() => startDan.mutate()}
          >
            {running
              ? dict?.settings.calculating
              : dict?.settings.calculateMissingDans}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!running || stopDan.isPending}
            onClick={() => stopDan.mutate()}
          >
            {sunnyDan?.status === "stopping"
              ? dict?.settings.stopping
              : dict?.settings.stop}
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
        id={pageSectionDomId("daniel-dan-calculation")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.danielDan ?? "Daniel dan calculation"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.danielDanDesc ??
            "Compute Daniel dan labels for 4K mania maps still missing a rating. More accurate than Sunny for 4K RC."}
        </p>

        {danielCoverage ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {danielCoverage.computed.toLocaleString()}
                </span>
                {" / "}
                {t(dict?.settings.maps4k, {
                  count: danielCoverage.fourKTotal.toLocaleString(),
                }) ?? `${danielCoverage.fourKTotal.toLocaleString()} 4K maps`}
              </span>
              <span>
                {t(dict?.settings.remaining, {
                  count: danielCoverage.missing.toLocaleString(),
                })}
              </span>
              {danielCoverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {t(dict?.settings.failed, {
                    count: danielCoverage.failed.toLocaleString(),
                  })}
                </span>
              ) : null}
            </div>

            <div className="h-2 overflow-hidden rounded bg-elevated">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${danielProgressPct}%` }}
              />
            </div>

            <p className="text-xs text-faint">
              {statusLabel(dict, danielDan?.status)}
              {danielRunning
                ? ` · ${t(dict?.settings.labeledThisRun, {
                    count: danielDan.computedThisRun.toLocaleString(),
                  })}`
                : null}
              {danielDan?.status === "completed" &&
              danielDan.computedThisRun > 0
                ? ` · ${t(dict?.settings.labeled, {
                    count: danielDan.computedThisRun.toLocaleString(),
                  })}`
                : null}
            </p>
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
              danielRunning ||
              startDaniel.isPending ||
              (danielCoverage?.missing ?? 0) === 0
            }
            onClick={() => startDaniel.mutate()}
          >
            {danielRunning
              ? dict?.settings.calculating
              : dict?.settings.calculateMissingDans}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!danielRunning || stopDaniel.isPending}
            onClick={() => stopDaniel.mutate()}
          >
            {danielDan?.status === "stopping"
              ? dict?.settings.stopping
              : dict?.settings.stop}
          </button>
        </div>

        {startDaniel.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {startDaniel.error.message}
          </p>
        ) : null}
        {danielDan?.error ? (
          <p className="mt-3 text-sm text-rose-300">{danielDan.error}</p>
        ) : null}
      </section>

      <section
        id={pageSectionDomId("pattern-analysis")}
        className="rx-panel scroll-mt-6 p-5"
      >
        <h2 className="text-sm font-bold text-ink">
          {dict?.settings.patternAnalysis}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {dict?.settings.patternAnalysisDesc}
        </p>
        <p className="mt-2 font-mono text-xs text-faint">
          {t(dict?.settings.algorithm, {
            name: patternAnalysis?.algorithm ?? "mania-interlude-v1",
          })}
        </p>

        {patternCoverage ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-subtle">
              <span>
                <span className="font-semibold text-ink">
                  {patternCoverage.computed.toLocaleString()}
                </span>
                {" / "}
                {t(dict?.settings.maps7k, {
                  count: (
                    patternCoverage.totalMania ?? patternCoverage.total7k
                  ).toLocaleString(),
                })}
              </span>
              <span>
                {t(dict?.settings.remaining, {
                  count: patternCoverage.missing.toLocaleString(),
                })}
              </span>
              {patternCoverage.failed > 0 ? (
                <span className="text-rose-300/90">
                  {t(dict?.settings.failed, {
                    count: patternCoverage.failed.toLocaleString(),
                  })}
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
              {patternCoverage.failed > 0 && !patternRunning
                ? ` · ${t(dict?.settings.unparsableSkipped, {
                    count: patternCoverage.failed.toLocaleString(),
                  })}`
                : null}
            </p>
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
              patternRunning ||
              startPattern.isPending ||
              recomputePattern.isPending ||
              (patternCoverage?.missing ?? 0) === 0
            }
            onClick={() => startPattern.mutate()}
          >
            {patternRunning && patternAnalysis?.mode !== "recompute"
              ? dict?.settings.calculating
              : dict?.settings.calculateMissingPatterns}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={
              patternRunning ||
              startPattern.isPending ||
              recomputePattern.isPending ||
              (patternCoverage?.totalMania ?? patternCoverage?.total7k ?? 0) ===
                0
            }
            onClick={() => recomputePattern.mutate()}
          >
            {patternRunning && patternAnalysis?.mode === "recompute"
              ? dict?.settings.recalculatingPatterns
              : dict?.settings.recalculateAllPatterns}
          </button>
          <button
            type="button"
            className="rx-btn"
            disabled={!patternRunning || stopPattern.isPending}
            onClick={() => stopPattern.mutate()}
          >
            {patternAnalysis?.status === "stopping"
              ? dict?.settings.stopping
              : dict?.settings.stop}
          </button>
        </div>

        {startPattern.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {startPattern.error.message}
          </p>
        ) : null}
        {recomputePattern.error ? (
          <p className="mt-3 text-sm text-rose-300">
            {recomputePattern.error.message}
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

function pathSourceLabel(
  dict: Dictionary["app"] | undefined,
  source: string,
): string {
  switch (source) {
    case "env":
      return dict?.settings.pathSource.env ?? "from environment";
    case "settings":
      return dict?.settings.pathSource.settings ?? "from settings";
    default:
      return dict?.settings.pathSource.default ?? "default";
  }
}

function pathStatusLabel(
  dict: Dictionary["app"] | undefined,
  status: {
    exists: boolean;
    hasRealm: boolean;
    hasFiles: boolean;
  },
): string {
  if (!status.exists) return dict?.settings.pathStatus.dirNotFound ?? "Directory not found";
  const bits = [
    status.hasRealm
      ? dict?.settings.pathStatus.realmFound ?? "client.realm found"
      : dict?.settings.pathStatus.realmMissing ?? "client.realm missing",
    status.hasFiles
      ? dict?.settings.pathStatus.filesFound ?? "files/ found"
      : dict?.settings.pathStatus.filesMissing ?? "files/ missing",
  ];
  return bits.join(" · ");
}

function statusLabel(
  dict: Dictionary["app"] | undefined,
  status: string | undefined,
): string {
  switch (status) {
    case "running":
      return dict?.settings.jobStatus.running ?? "Running";
    case "stopping":
      return dict?.settings.jobStatus.stopping ?? "Stopping after current batch";
    case "completed":
      return dict?.settings.jobStatus.completed ?? "Complete";
    case "error":
      return dict?.settings.jobStatus.error ?? "Stopped with error";
    default:
      return dict?.settings.jobStatus.idle ?? "Idle";
  }
}
