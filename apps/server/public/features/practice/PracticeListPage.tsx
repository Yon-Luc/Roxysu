import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import { PatternBrowserButton } from "../../components/PatternBrowserModal";
import { BeatmapCover } from "../../components/BeatmapCover";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewModal";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import {
  fetchPracticeDistribution,
  fetchPracticeList,
  type PracticeItem,
  type PracticeMetric,
  type PracticeSortBy,
  type PracticeSortDir,
} from "../../lib/api";
import {
  formatAccuracy,
  formatMisses,
  formatPp,
  formatRelativeTime,
  formatScore,
} from "../../lib/format";
import {
  formatPrimaryRating,
  primaryDanLabel,
  primaryDanSource,
  primaryRatingDisplayTitle,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";
import {
  readStoredPracticeSearch,
  writeStoredPracticeSearch,
  type StoredPracticeSearch,
} from "../../lib/practiceSearch";

const SORT_OPTIONS: PracticeSortBy[] = [
  "lastPlayed",
  "accuracy",
  "misses",
  "score",
  "pp",
  "mastery",
  "stars",
];

const SORT_LABEL_FALLBACK: Record<PracticeSortBy, string> = {
  lastPlayed: "Last played",
  accuracy: "Accuracy",
  misses: "Misses",
  score: "Score",
  pp: "PP",
  mastery: "Mastery",
  stars: "Stars",
};

const METRIC_OPTIONS: PracticeMetric[] = ["accuracy", "misses", "score"];

const METRIC_LABEL_FALLBACK: Record<PracticeMetric, string> = {
  accuracy: "Accuracy",
  misses: "Misses",
  score: "Score",
};

/** Remove prior chart/distribution filters so a new bar click replaces them. */
function stripDistributionFilters(query: string): string {
  return query
    .replace(/\bplayed:never\b/gi, " ")
    .replace(/\b(?:acc|accuracy|misses|miss|score)(?::\S+|(?:>=|<=|>|<|=)\S+)/gi, " ")
    .replace(/\b(?:AND|OR)\s+(?=(?:AND|OR)\b|$)/gi, " ")
    .replace(/(^|\s)(?:AND|OR)\b/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupMergedQuery(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/\bAND\s+AND\b/gi, "AND")
    .replace(/^\s*(?:AND|OR)\s+/i, "")
    .replace(/\s+(?:AND|OR)\s*$/i, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toFixed(4)).toString();
}

function binToQueryClause(
  metric: PracticeMetric,
  bin: { key: string; label: string },
): string | null {
  if (bin.key === "unplayed") return "played:never";

  if (metric === "misses") {
    switch (bin.key) {
      case "0":
        return "misses:0";
      case "1":
        return "misses:1";
      case "2-5":
        return "misses:2..5";
      case "6-10":
        return "misses:6..10";
      case "11-25":
        return "misses:11..25";
      case "26-50":
        return "misses:26..50";
      case "51+":
        return "misses>=51";
      default:
        return null;
    }
  }

  const parts = bin.key.split("-");
  if (parts.length !== 2) return null;
  const from = Number(parts[0]);
  const to = Number(parts[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  if (metric === "accuracy") {
    if (from >= 100) return "acc>=100";
    if (to >= 100) return `acc>=${formatNum(from)}`;
    return `acc>=${formatNum(from)} AND acc<${formatNum(to)}`;
  }

  if (from === to) return `score>=${formatNum(from)}`;
  return `score>=${formatNum(from)} AND score<${formatNum(to)}`;
}

function mergeRangeIntoQuery(
  current: string,
  metric: PracticeMetric,
  bin: { key: string; label: string },
): string | null {
  const clause = binToQueryClause(metric, bin);
  if (!clause) return null;
  const base = stripDistributionFilters(current);
  if (!base) return clause;
  return cleanupMergedQuery(`${base} ${clause}`);
}

export function PracticeListPage() {
  const ratingMode = useRatingDisplayMode();
  const { dict } = useAppDict();
  const ratingListLabels = {
    danielDan: dict?.practice.detail.danielDan ?? "Daniel dan",
    sunnyDan: dict?.practice.detail.sunnyDan ?? "Sunny dan",
    danielStar:
      dict?.settings.ratingDisplay.dan?.labelDanielStar ?? "Daniel star rating",
    sunnyStar:
      dict?.settings.ratingDisplay.sunny?.label ?? "Sunny star rating",
  };
  const [stored] = useState(readStoredPracticeSearch);
  const [q, setQ] = useState(stored.q);
  const [page, setPage] = useState(stored.page);
  const [submitted, setSubmitted] = useState(stored.q);
  const [sortBy, setSortBy] = useState<PracticeSortBy>(stored.sortBy);
  const [sortDir, setSortDir] = useState<PracticeSortDir>(stored.sortDir);
  const [metric, setMetric] = useState<PracticeMetric>(stored.metric);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (pathname !== "/practice") return;
    const stored = readStoredPracticeSearch();
    setQ(stored.q);
    setSubmitted(stored.q);
    setPage(stored.page);
    setSortBy(stored.sortBy);
    setSortDir(stored.sortDir);
    setMetric(stored.metric);
  }, [pathname]);

  function persist(next: Partial<StoredPracticeSearch> & { q?: string }) {
    const state: StoredPracticeSearch = {
      q: next.q ?? submitted,
      page: next.page ?? page,
      sortBy: next.sortBy ?? sortBy,
      sortDir: next.sortDir ?? sortDir,
      metric: next.metric ?? metric,
    };
    writeStoredPracticeSearch(state);
  }

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["practice", { page, q: submitted, sortBy, sortDir }],
    queryFn: () =>
      fetchPracticeList({
        page,
        pageSize: 24,
        q: submitted || undefined,
        sortBy,
        sortDir,
      }),
  });

  const {
    data: distribution,
    isLoading: distLoading,
    error: distError,
  } = useQuery({
    queryKey: ["practice-distribution", { q: submitted, metric }],
    queryFn: () =>
      fetchPracticeDistribution({
        q: submitted || undefined,
        metric,
      }),
  });

  const list =
    data && "items" in data && Array.isArray(data.items)
      ? {
          items: data.items,
          total: data.total ?? 0,
          pageSize: data.pageSize ?? 24,
          queryMode: "queryMode" in data ? data.queryMode : undefined,
        }
      : null;
  const totalPages = list
    ? Math.max(1, Math.ceil(list.total / list.pageSize))
    : 1;

  const bins =
    distribution && "bins" in distribution ? distribution.bins : null;

  function applySearch(nextQ: string, opts?: { fromChart?: boolean }) {
    if (opts?.fromChart) {
      setQueryHistory((prev) => [...prev, submitted]);
    } else {
      setQueryHistory([]);
    }
    setQ(nextQ);
    setSubmitted(nextQ);
    setPage(1);
    persist({ q: nextQ, page: 1 });
  }

  function undoQuery() {
    if (queryHistory.length === 0) return;
    const previous = queryHistory[queryHistory.length - 1] ?? "";
    setQueryHistory((prev) => prev.slice(0, -1));
    setQ(previous);
    setSubmitted(previous);
    setPage(1);
    persist({ q: previous, page: 1 });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PageTitle>{dict?.nav.practice ?? "Practice"}</PageTitle>
          <p className="rx-subtitle">
            {dict?.practice.subtitle ??
              "Plain text or query language — e.g."}{" "}
            <code className="text-subtle">mode:mania stars:5..6</code>
            {" · "}
            <QueryLanguageHelpButton />
            {" · "}
            <PatternBrowserButton onApplyQuery={(query) => applySearch(query)} />
          </p>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch(q.trim());
          }}
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              dict?.practice.searchPlaceholder ??
              "Search or mode:mania mastery>50…"
            }
            className="rx-input w-72"
          />
          <button type="submit" className="rx-btn-primary">
            {dict?.practice.search ?? "Search"}
          </button>
        </form>
      </div>

      <section className="rx-panel px-4 py-5 sm:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink">
              {dict?.practice.bestScoreDistribution ??
                "Best-score distribution"}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {dict?.practice.distributionHint ??
                "Across all maps matching the current query — click a bar to filter that range."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queryHistory.length > 0 ? (
              <button
                type="button"
                onClick={undoQuery}
                className="rx-btn text-xs"
                title={
                  queryHistory[queryHistory.length - 1]
                    ? t(dict?.practice.restoreQuery, {
                        query: queryHistory[queryHistory.length - 1],
                      })
                    : dict?.practice.clearRangeFilter ?? "Clear range filter"
                }
              >
                {dict?.practice.undoFilter ?? "Undo filter"}
              </button>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-muted">
              {dict?.practice.show ?? "Show"}
              <select
                className="rx-select"
                value={metric}
                onChange={(e) => {
                  const next = e.target.value as PracticeMetric;
                  setMetric(next);
                  persist({ metric: next });
                }}
              >
                {METRIC_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {dict?.practice.metricLabels[value] ??
                      METRIC_LABEL_FALLBACK[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {distLoading ? (
          <div className="py-2">
            <SkeletonBlock className="h-[220px] w-full" />
          </div>
        ) : distError || !bins ? (
          <p className="py-10 text-center text-sm text-rose-300">
            {distError?.message ??
              dict?.practice.failedToLoadDistribution ??
              "Failed to load distribution"}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#a7a7a7", fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={48}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#a7a7a7", fontSize: 11 }}
                width={40}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "#242424",
                  border: "none",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                }}
                labelStyle={{ color: "#b3b3b3" }}
                itemStyle={{ color: "#fff" }}
                formatter={(value) => [
                  Number(value).toLocaleString(),
                  dict?.practice.maps ?? "maps",
                ]}
              />
              <Bar
                dataKey="count"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(_data, index) => {
                  const bin = bins[index];
                  if (!bin) return;
                  const next = mergeRangeIntoQuery(submitted, metric, bin);
                  if (next == null) return;
                  applySearch(next, { fromChart: true });
                }}
              >
                {bins.map((bin) => (
                  <Cell
                    key={bin.key}
                    fill={
                      bin.key === "unplayed"
                        ? "rgba(167, 167, 167, 0.45)"
                        : "#7c8fe0"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <label className="flex items-center gap-2">
              {dict?.practice.sort ?? "Sort"}
              <select
                className="rx-select"
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value as PracticeSortBy;
                  setSortBy(next);
                  setPage(1);
                  persist({ sortBy: next, page: 1 });
                }}
              >
                {SORT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {dict?.practice.sortLabels[value] ??
                      SORT_LABEL_FALLBACK[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              {dict?.practice.order ?? "Order"}
              <select
                className="rx-select"
                value={sortDir}
                onChange={(e) => {
                  const next = e.target.value as PracticeSortDir;
                  setSortDir(next);
                  setPage(1);
                  persist({ sortDir: next, page: 1 });
                }}
              >
                <option value="asc">
                  {dict?.practice.ascending ?? "Ascending"}
                </option>
                <option value="desc">
                  {dict?.practice.descending ?? "Descending"}
                </option>
              </select>
            </label>
          </div>

        {list ? (
          <div className="text-xs text-muted">
            {t(dict?.practice.mapsCount, { count: list.total })}
            {list.queryMode === "structured"
              ? ` · ${dict?.practice.queryBadge ?? "query"}`
              : ""}
            {isFetching ? ` · ${dict?.practice.refreshing ?? "refreshing…"}` : ""}
            {" · "}
            {t(dict?.practice.page, { page, total: totalPages })}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <>
          <section className="rx-panel px-4 py-5 sm:px-5">
            <PageHeaderSkeleton
              subtitleWidth="w-72"
              actions={
                <>
                  <SkeletonBlock className="h-10 w-40 rounded-md" />
                  <SkeletonBlock className="h-10 w-28 rounded-md" />
                </>
              }
            />
            <div className="mt-5">
              <PanelSkeleton lines={1} className="min-h-[16rem] p-0" />
            </div>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <SkeletonBlock className="h-9 w-32 rounded-md" />
              <SkeletonBlock className="h-9 w-32 rounded-md" />
            </div>
            <SkeletonBlock className="h-4 w-28" />
          </div>
          <CardGridSkeleton count={6} />
        </>
      ) : error ? (
        <p className="text-rose-300">
          {t(dict?.practice.failedToLoad, { error: error.message })}
        </p>
      ) : !list || list.items.length === 0 ? (
        <p className="text-sm text-muted">
          {dict?.practice.noMatch ?? "No beatmaps match."}
        </p>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((item: PracticeItem) => {
              const primarySource = primaryDanSource({
                mode: ratingMode,
                keyCount: item.keyCount,
                danielEstDiff: item.danielEstDiff,
                danielStar: item.danielStar,
                sunnyEstDiff: item.sunnyEstDiff,
                sunnyStar: item.sunnyStar,
              });
              const primaryTitle = primaryRatingDisplayTitle(
                ratingMode,
                primarySource,
                ratingListLabels,
              );
              const danLabel = primaryDanLabel({
                sunnyEstDiff: item.sunnyEstDiff,
                danielEstDiff: item.danielEstDiff,
                keyCount: item.keyCount,
              });

              return (
              <li key={item.id} className="rx-card flex flex-col">
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: item.id }}
                  className="block min-h-0 flex-1"
                >
                  <div className="relative">
                    <BeatmapCover
                      backgroundFileHash={item.backgroundFileHash}
                      setOnlineId={item.setOnlineId}
                      size="card"
                      className="aspect-[2.2/1] w-full"
                      alt=""
                    />
                    {ratingMode !== "dan" && danLabel ? (
                      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-canvas/85 px-2 py-1 text-[11px] font-semibold leading-none text-ink shadow-sm ring-1 ring-white/10 backdrop-blur-sm">
                        {danLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-muted">
                          {item.artist ?? dict?.practice.unknownArtist ?? "Unknown artist"}
                        </div>
                        <div className="mt-0.5 truncate font-bold text-ink">
                          {item.title ?? dict?.practice.untitled ?? "Untitled"}
                        </div>
                      </div>
                      {item.masteryLevel != null ? (
                        <span className="shrink-0 rounded-full bg-accent-glow px-2 py-0.5 text-xs font-bold tabular-nums text-accent">
                          {item.masteryLevel.toFixed(0)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted">
                      {ratingMode !== "osu" && primaryTitle ? (
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                          {primaryTitle}
                        </div>
                      ) : null}
                      <div>
                        [{item.difficultyName ?? "—"}] ·{" "}
                        {formatPrimaryRating({
                          mode: ratingMode,
                          starRating: item.starRating,
                          sunnyEstDiff: item.sunnyEstDiff,
                          sunnyStar: item.sunnyStar,
                          danielEstDiff: item.danielEstDiff,
                          danielStar: item.danielStar,
                          keyCount: item.keyCount,
                        })}
                        {item.mapperUsername ? ` · ${item.mapperUsername}` : ""}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-subtle">
                      <span>
                        {t(dict?.practice.playsCount, { count: item.playCount })}
                      </span>
                      <span>{formatAccuracy(item.bestAccuracy)}</span>
                      <span>{formatMisses(item.bestMisses)}</span>
                      <span>{formatScore(item.bestScore)}</span>
                      <span>{formatPp(item.bestPp)}</span>
                      <span>{formatRelativeTime(item.lastPlayedAt)}</span>
                    </div>
                  </div>
                </Link>
                <div className="flex flex-wrap gap-2 px-4 pb-4">
                  <BeatmapPreviewButton beatmapId={item.id} />
                  <CopyBeatmapSearchButton
                    title={item.title}
                    difficultyName={item.difficultyName}
                  />
                </div>
              </li>
            );
            })}
          </ul>

          <div className="flex justify-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                persist({ page: next });
              }}
              className="rx-btn"
            >
              {dict?.practice.previous ?? "Previous"}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                persist({ page: next });
              }}
              className="rx-btn"
            >
              {dict?.practice.next ?? "Next"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
