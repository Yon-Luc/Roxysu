import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import { fetchPracticeList, type PracticeItem } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
  formatStars,
} from "../../lib/format";

export function PracticeListPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["practice", { page, q: submitted }],
    queryFn: () =>
      fetchPracticeList({ page, pageSize: 24, q: submitted || undefined }),
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
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSubmitted(q.trim());
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

      {isLoading ? (
        <p className="text-[#8b93a7]">Loading practice list…</p>
      ) : error ? (
        <p className="text-rose-300">Failed to load: {error.message}</p>
      ) : !list || list.items.length === 0 ? (
        <p className="text-sm text-[#8b93a7]">No beatmaps match.</p>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-[#8b93a7]">
            <span>
              {list.total.toLocaleString()} maps
              {"queryMode" in list && list.queryMode === "structured"
                ? " · query"
                : ""}
              {isFetching ? " · refreshing…" : ""}
            </span>
            <span>
              Page {page} / {totalPages}
            </span>
          </div>

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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
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
