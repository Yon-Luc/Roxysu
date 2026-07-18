import { useState } from "react";
import { Link } from "@tanstack/react-router";
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
  formatStars,
} from "../../lib/format";

const PRACTICE_SEARCH_KEY = "roxysu:practice-search";

type StoredPracticeSearch = {
  q: string;
  page: number;
  sortBy: PracticeSortBy;
  sortDir: PracticeSortDir;
  metric: PracticeMetric;
};

const SORT_OPTIONS: { value: PracticeSortBy; label: string }[] = [
  { value: "lastPlayed", label: "Last played" },
  { value: "accuracy", label: "Accuracy" },
  { value: "misses", label: "Misses" },
  { value: "score", label: "Score" },
  { value: "pp", label: "PP" },
  { value: "mastery", label: "Mastery" },
  { value: "stars", label: "Stars" },
];

const METRIC_OPTIONS: { value: PracticeMetric; label: string }[] = [
  { value: "accuracy", label: "Accuracy" },
  { value: "misses", label: "Misses" },
  { value: "score", label: "Score" },
];

function isSortBy(value: unknown): value is PracticeSortBy {
  return SORT_OPTIONS.some((o) => o.value === value);
}

function isSortDir(value: unknown): value is PracticeSortDir {
  return value === "asc" || value === "desc";
}

function isMetric(value: unknown): value is PracticeMetric {
  return METRIC_OPTIONS.some((o) => o.value === value);
}

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
    // Match histogram buckets: [from, to) except exact 100%.
    if (from >= 100) return "acc>=100";
    if (to >= 100) return `acc>=${formatNum(from)}`;
    return `acc>=${formatNum(from)} AND acc<${formatNum(to)}`;
  }

  // score — same half-open buckets as the chart
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
  // Plain text → keep as free-text term ANDed with the range.
  return cleanupMergedQuery(`${base} ${clause}`);
}

function readStoredPracticeSearch(): StoredPracticeSearch {
  try {
    const raw = localStorage.getItem(PRACTICE_SEARCH_KEY);
    if (!raw) {
      return {
        q: "",
        page: 1,
        sortBy: "lastPlayed",
        sortDir: "desc",
        metric: "accuracy",
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredPracticeSearch>;
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      page:
        typeof parsed.page === "number" &&
        Number.isFinite(parsed.page) &&
        parsed.page >= 1
          ? Math.floor(parsed.page)
          : 1,
      sortBy: isSortBy(parsed.sortBy) ? parsed.sortBy : "lastPlayed",
      sortDir: isSortDir(parsed.sortDir) ? parsed.sortDir : "desc",
      metric: isMetric(parsed.metric) ? parsed.metric : "accuracy",
    };
  } catch {
    return {
      q: "",
      page: 1,
      sortBy: "lastPlayed",
      sortDir: "desc",
      metric: "accuracy",
    };
  }
}

function writeStoredPracticeSearch(state: StoredPracticeSearch) {
  localStorage.setItem(PRACTICE_SEARCH_KEY, JSON.stringify(state));
}

const selectClass =
  "rounded-md border border-white/10 bg-[#151922] px-2.5 py-2 text-sm text-white outline-none focus:border-white/25";

export function PracticeListPage() {
  const [stored] = useState(readStoredPracticeSearch);
  const [q, setQ] = useState(stored.q);
  const [page, setPage] = useState(stored.page);
  const [submitted, setSubmitted] = useState(stored.q);
  const [sortBy, setSortBy] = useState<PracticeSortBy>(stored.sortBy);
  const [sortDir, setSortDir] = useState<PracticeSortDir>(stored.sortDir);
  const [metric, setMetric] = useState<PracticeMetric>(stored.metric);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Practice
          </h1>
          <p className="mt-1 text-sm text-[#8b93a7]">
            Plain text or query language — e.g.{" "}
            <code className="text-[#a8b0c0]">mode:mania stars:5..6</code>
            {" · "}
            <QueryLanguageHelpButton />
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
            placeholder="Search or mode:mania mastery>50…"
            className="w-72 rounded-md border border-white/10 bg-[#151922] px-3 py-2 text-sm text-white placeholder:text-[#6b7385] outline-none focus:border-white/25"
          />
          <button
            type="submit"
            className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
          >
            Search
          </button>
        </form>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#151922] px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">
              Best-score distribution
            </h2>
            <p className="mt-0.5 text-xs text-[#8b93a7]">
              Across all maps matching the current query — click a bar to filter
              that range.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queryHistory.length > 0 ? (
              <button
                type="button"
                onClick={undoQuery}
                className="rounded-md border border-white/10 px-2.5 py-2 text-xs text-[#a8b0c0] hover:border-white/20 hover:text-white"
                title={
                  queryHistory[queryHistory.length - 1]
                    ? `Restore: ${queryHistory[queryHistory.length - 1]}`
                    : "Clear range filter"
                }
              >
                Undo filter
              </button>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-[#8b93a7]">
              Show
              <select
                className={selectClass}
                value={metric}
                onChange={(e) => {
                  const next = e.target.value as PracticeMetric;
                  setMetric(next);
                  persist({ metric: next });
                }}
              >
                {METRIC_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {distLoading ? (
          <p className="py-10 text-center text-sm text-[#8b93a7]">
            Loading distribution…
          </p>
        ) : distError || !bins ? (
          <p className="py-10 text-center text-sm text-rose-300">
            {distError?.message ?? "Failed to load distribution"}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#8b93a7", fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={48}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#8b93a7", fontSize: 11 }}
                width={40}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "#151922",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                }}
                labelStyle={{ color: "#a8b0c0" }}
                itemStyle={{ color: "#fff" }}
                formatter={(value) => [
                  Number(value).toLocaleString(),
                  "maps",
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
                        ? "rgba(139, 147, 167, 0.55)"
                        : "#6b8afd"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#8b93a7]">
          <label className="flex items-center gap-2">
            Sort
            <select
              className={selectClass}
              value={sortBy}
              onChange={(e) => {
                const next = e.target.value as PracticeSortBy;
                setSortBy(next);
                setPage(1);
                persist({ sortBy: next, page: 1 });
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Order
            <select
              className={selectClass}
              value={sortDir}
              onChange={(e) => {
                const next = e.target.value as PracticeSortDir;
                setSortDir(next);
                setPage(1);
                persist({ sortDir: next, page: 1 });
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>

        {list ? (
          <div className="text-xs text-[#8b93a7]">
            {list.total.toLocaleString()} maps
            {list.queryMode === "structured" ? " · query" : ""}
            {isFetching ? " · refreshing…" : ""}
            {" · "}
            Page {page} / {totalPages}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-[#8b93a7]">Loading practice list…</p>
      ) : error ? (
        <p className="text-rose-300">Failed to load: {error.message}</p>
      ) : !list || list.items.length === 0 ? (
        <p className="text-sm text-[#8b93a7]">No beatmaps match.</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.items.map((item: PracticeItem) => (
              <li key={item.id}>
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: item.id }}
                  className="block h-full rounded-lg border border-white/10 bg-[#151922] p-4 transition hover:border-white/20 hover:bg-[#181c26]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-[#8b93a7]">
                        {item.artist ?? "Unknown artist"}
                      </div>
                      <div className="mt-0.5 truncate font-medium text-white">
                        {item.title ?? "Untitled"}
                      </div>
                    </div>
                    {item.masteryLevel != null ? (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-xs tabular-nums text-[#a8b0c0]">
                        {item.masteryLevel.toFixed(0)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-[#8b93a7]">
                    [{item.difficultyName ?? "—"}] · {formatStars(item.starRating)}
                    {item.mapperUsername ? ` · ${item.mapperUsername}` : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-[#a8b0c0]">
                    <span>{item.playCount} plays</span>
                    <span>{formatAccuracy(item.bestAccuracy)}</span>
                    <span>{formatMisses(item.bestMisses)}</span>
                    <span>{formatScore(item.bestScore)}</span>
                    <span>{formatPp(item.bestPp)}</span>
                    <span>{formatRelativeTime(item.lastPlayedAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
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
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                const next = page + 1;
                setPage(next);
                persist({ page: next });
              }}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
