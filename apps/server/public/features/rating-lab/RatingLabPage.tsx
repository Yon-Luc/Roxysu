import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import { BeatmapCover } from "../../components/BeatmapCover";
import { PageTitle } from "../../components/PageTitle";
import {
  fetchRatingLabCompare,
  fetchRatingLabJob,
  fetchRatingLabSummary,
  fetchRatingLabVersions,
  startRatingLabJob,
  stopRatingLabJob,
  type RatingLabCompareItem,
} from "../../lib/api";
import { formatPp, formatStars } from "../../lib/format";

const RATING_LAB_QUERY_KEY = "roxysu:rating-lab-query";

const EXAMPLE_QUERIES = [
  "mode:mania key=7 ranked",
  "mode:mania key=4 stars:6..8",
  "mode:mania ln<15 stars:7..9",
];

function readStoredQuery(): string {
  try {
    return localStorage.getItem(RATING_LAB_QUERY_KEY) ?? EXAMPLE_QUERIES[0]!;
  } catch {
    return EXAMPLE_QUERIES[0]!;
  }
}

function storeQuery(q: string): void {
  try {
    localStorage.setItem(RATING_LAB_QUERY_KEY, q);
  } catch {
    // ignore
  }
}

function formatDelta(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function deltaClass(value: number | null): string {
  if (value == null || Math.abs(value) < 0.05) return "text-muted";
  return value > 0 ? "text-amber-300" : "text-sky-300";
}

export function RatingLabPage() {
  const queryClient = useQueryClient();
  const [queryDraft, setQueryDraft] = useState(readStoredQuery);
  const [activeQuery, setActiveQuery] = useState(readStoredQuery);
  const [baseline, setBaseline] = useState("");
  const [experiment, setExperiment] = useState("");
  const [page, setPage] = useState(1);

  const versionsQuery = useQuery({
    queryKey: ["rating-lab", "versions"],
    queryFn: fetchRatingLabVersions,
  });

  const versions = versionsQuery.data?.versions ?? [];
  const baselineId =
    baseline || versionsQuery.data?.defaults.baseline || "lazer-master";
  const experimentId =
    experiment ||
    versionsQuery.data?.defaults.experiment ||
    "enissay-accuracy-change";

  const compareQuery = useQuery({
    queryKey: [
      "rating-lab",
      "compare",
      activeQuery,
      baselineId,
      experimentId,
      page,
    ],
    queryFn: () =>
      fetchRatingLabCompare({
        q: activeQuery,
        baseline: baselineId,
        experiment: experimentId,
        page,
        pageSize: 48,
      }),
    enabled: activeQuery.trim().length > 0,
  });

  const summaryQuery = useQuery({
    queryKey: [
      "rating-lab",
      "summary",
      activeQuery,
      baselineId,
      experimentId,
    ],
    queryFn: () =>
      fetchRatingLabSummary({
        q: activeQuery,
        baseline: baselineId,
        experiment: experimentId,
      }),
    enabled: activeQuery.trim().length > 0,
  });

  const jobQuery = useQuery({
    queryKey: ["rating-lab", "job"],
    queryFn: fetchRatingLabJob,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const jobMut = useMutation({
    mutationFn: async (
      action: "stop" | { start: "baseline" | "experiment" },
    ) => {
      if (action === "stop") return stopRatingLabJob();
      const versionId =
        action.start === "baseline" ? baselineId : experimentId;
      return startRatingLabJob({
        versionId,
        query: activeQuery,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "job"] });
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "compare"] });
      void queryClient.invalidateQueries({ queryKey: ["rating-lab", "summary"] });
    },
  });

  const jobBusy =
    jobMut.isPending ||
    jobQuery.data?.status === "running" ||
    jobQuery.data?.status === "stopping";

  const baselineLabel =
    versions.find((v) => v.id === baselineId)?.label ?? baselineId;
  const experimentLabel =
    versions.find((v) => v.id === experimentId)?.label ?? experimentId;

  const baselineUsesImport =
    versions.find((v) => v.id === baselineId)?.usesImport ?? false;

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      q: activeQuery,
      baseline: baselineId,
      experiment: experimentId,
    });
    return `/api/rating-lab/export?${params.toString()}`;
  }, [activeQuery, baselineId, experimentId]);

  const summary =
    summaryQuery.data && !("error" in summaryQuery.data)
      ? summaryQuery.data
      : null;
  const compareData =
    compareQuery.data && !("error" in compareQuery.data)
      ? compareQuery.data
      : null;
  const histogram = summary?.starRatingHistogram ?? [];

  const totalPages = compareData
    ? Math.max(1, Math.ceil(compareData.total / compareData.pageSize))
    : 1;

  function runSearch() {
    const q = queryDraft.trim();
    if (!q) return;
    storeQuery(q);
    setActiveQuery(q);
    setPage(1);
  }

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Rating Lab</PageTitle>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Compare experimental mania star rating and SS PP against a baseline.
          Uses local{" "}
          <code className="text-xs">.osu</code> files and versioned calculator
          binaries configured in Settings.
        </p>
      </div>

      <section className="rx-panel space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              Query
            </span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
                placeholder="mode:mania key=7 ranked"
                className="w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                spellCheck={false}
              />
              <QueryLanguageHelpButton />
            </div>
          </label>
          <button type="button" className="rx-btn-primary" onClick={runSearch}>
            Compare
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              className="rounded-lg bg-elevated/60 px-2.5 py-1 font-mono text-xs text-muted hover:bg-elevated hover:text-ink"
              onClick={() => {
                setQueryDraft(q);
                storeQuery(q);
                setActiveQuery(q);
                setPage(1);
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              Baseline
            </span>
            <select
              value={baselineId}
              onChange={(e) => {
                setBaseline(e.target.value);
                setPage(1);
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.usesImport
                    ? " (import)"
                    : !v.executableConfigured
                      ? " (no binary)"
                      : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">
              Experiment
            </span>
            <select
              value={experimentId}
              onChange={(e) => {
                setExperiment(e.target.value);
                setPage(1);
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-elevated/50 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {!v.usesImport && !v.executableConfigured ? " (no binary)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {summary ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rx-panel p-4">
            <div className="text-xs uppercase tracking-wide text-faint">
              Matches
            </div>
            <div className="mt-1 text-2xl font-bold text-ink">
              {summary.totalMatches.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-muted">
              {summary.comparedCount.toLocaleString()} with both ratings
            </div>
          </div>
          <div className="rx-panel p-4">
            <div className="text-xs uppercase tracking-wide text-faint">
              Mean Δ SR
            </div>
            <div
              className={`mt-1 text-2xl font-bold ${deltaClass(summary.meanDeltaStarRating)}`}
            >
              {formatDelta(summary.meanDeltaStarRating, 3)}★
            </div>
            <div className="mt-1 text-xs text-muted">
              median {formatDelta(summary.medianDeltaStarRating, 3)}★
            </div>
          </div>
          <div className="rx-panel p-4">
            <div className="text-xs uppercase tracking-wide text-faint">
              Mean Δ PP (SS)
            </div>
            <div
              className={`mt-1 text-2xl font-bold ${deltaClass(summary.meanDeltaPpSs)}`}
            >
              {formatDelta(summary.meanDeltaPpSs, 1)}
            </div>
            <div className="mt-1 text-xs text-muted">
              median {formatDelta(summary.medianDeltaPpSs, 1)}
            </div>
          </div>
          <div className="rx-panel p-4">
            <div className="text-xs uppercase tracking-wide text-faint">
              Missing cache
            </div>
            <div className="mt-1 text-2xl font-bold text-ink">
              {summary.missingBaseline + summary.missingExperiment}
            </div>
            <div className="mt-1 text-xs text-muted">
              baseline {summary.missingBaseline} · experiment{" "}
              {summary.missingExperiment}
            </div>
          </div>
        </section>
      ) : null}

      {histogram.length > 0 ? (
        <section className="rx-panel p-5">
          <h2 className="text-sm font-bold text-ink">SR delta distribution</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--color-faint)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-elevated)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <section className="rx-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Results</h2>
            <p className="mt-1 font-mono text-xs text-faint">{activeQuery}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={exportUrl} className="rx-btn" download>
              Export CSV
            </a>
            <button
              type="button"
              className="rx-btn"
              disabled={jobBusy}
              title="Recompute missing baseline ratings (including Base PP) for this query"
              onClick={() => jobMut.mutate({ start: "baseline" })}
            >
              Rerun baseline
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={jobBusy}
              title="Recompute missing experiment ratings for this query"
              onClick={() => jobMut.mutate({ start: "experiment" })}
            >
              Rerun experiment
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={
                jobMut.isPending ||
                (jobQuery.data?.status !== "running" &&
                  jobQuery.data?.status !== "stopping")
              }
              onClick={() => jobMut.mutate("stop")}
            >
              Stop
            </button>
          </div>
        </div>

        {jobQuery.data && jobQuery.data.status !== "idle" ? (
          <p className="mt-3 text-xs text-muted">
            Job: {jobQuery.data.status}
            {jobQuery.data.versionId ? ` · ${jobQuery.data.versionId}` : ""}
            {jobQuery.data.computedThisRun > 0
              ? ` · ${jobQuery.data.computedThisRun} computed this run`
              : ""}
          </p>
        ) : null}

        {compareQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading comparison…</p>
        ) : compareQuery.error ? (
          <p className="mt-4 text-sm text-rose-300">
            {compareQuery.error.message}
          </p>
        ) : !compareData || compareData.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No matches.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <th className="px-2 py-2">Map</th>
                    {!baselineUsesImport ? (
                      <th className="px-2 py-2">Import ★</th>
                    ) : null}
                    <th className="px-2 py-2">{baselineLabel} ★</th>
                    <th className="px-2 py-2">{experimentLabel} ★</th>
                    <th className="px-2 py-2">Δ★</th>
                    <th className="px-2 py-2">Base PP</th>
                    <th className="px-2 py-2">Exp PP</th>
                    <th className="px-2 py-2">ΔPP</th>
                  </tr>
                </thead>
                <tbody>
                  {compareData.items.map((item: RatingLabCompareItem) => (
                    <tr
                      key={item.beatmapId}
                      className="border-b border-line/60 hover:bg-elevated/40"
                    >
                      <td className="px-2 py-2">
                        <Link
                          to="/practice/$beatmapId"
                          params={{ beatmapId: item.beatmapId }}
                          className="flex items-center gap-3"
                        >
                          <BeatmapCover
                            backgroundFileHash={null}
                            className="h-10 w-10 shrink-0 rounded-lg"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">
                              {item.title ?? "Unknown"}
                            </div>
                            <div className="truncate text-xs text-muted">
                              {item.artist ?? "?"}
                              {item.difficultyName
                                ? ` [${item.difficultyName}]`
                                : ""}
                              {item.keyCount != null
                                ? ` · ${item.keyCount}K`
                                : ""}
                            </div>
                            {item.baseline.error || item.experiment.error ? (
                              <div className="truncate text-xs text-rose-300">
                                {item.experiment.error ?? item.baseline.error}
                              </div>
                            ) : null}
                          </div>
                        </Link>
                      </td>
                      {!baselineUsesImport ? (
                        <td className="px-2 py-2 font-mono text-muted">
                          {formatStars(item.importedStarRating)}
                        </td>
                      ) : null}
                      <td className="px-2 py-2 font-mono">
                        {item.baseline.starRating != null
                          ? formatStars(item.baseline.starRating)
                          : "—"}
                      </td>
                      <td className="px-2 py-2 font-mono">
                        {item.experiment.starRating != null
                          ? formatStars(item.experiment.starRating)
                          : "—"}
                      </td>
                      <td
                        className={`px-2 py-2 font-mono ${deltaClass(item.delta.starRating)}`}
                      >
                        {formatDelta(item.delta.starRating, 3)}
                      </td>
                      <td className="px-2 py-2 font-mono text-muted">
                        {item.baseline.ppSs != null
                          ? formatPp(item.baseline.ppSs)
                          : "—"}
                      </td>
                      <td className="px-2 py-2 font-mono">
                        {item.experiment.ppSs != null
                          ? formatPp(item.experiment.ppSs)
                          : "—"}
                      </td>
                      <td
                        className={`px-2 py-2 font-mono ${deltaClass(item.delta.ppSs)}`}
                      >
                        {formatDelta(item.delta.ppSs, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>
                {compareData.total.toLocaleString()} matches · page{" "}
                {compareData.page} / {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rx-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rx-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {summary && summary.topStarMovers.length > 0 ? (
        <section className="rx-panel p-5">
          <h2 className="text-sm font-bold text-ink">Largest SR movers</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.topStarMovers.map((item: RatingLabCompareItem) => (
              <li key={item.beatmapId} className="flex justify-between gap-4">
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: item.beatmapId }}
                  className="truncate text-ink hover:underline"
                >
                  {item.title} [{item.difficultyName}]
                </Link>
                <span className={`shrink-0 font-mono ${deltaClass(item.delta.starRating)}`}>
                  {formatDelta(item.delta.starRating, 3)}★
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
