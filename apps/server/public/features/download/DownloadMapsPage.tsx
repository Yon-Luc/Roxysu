import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
import { SkeletonBlock, CardGridSkeleton } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import {
  checkMissingBeatmapsets,
  fetchMirrorBatchJob,
  fetchMirrorDownloadDir,
  fetchMirrorProviders,
  fetchMirrorSearch,
  startMirrorBatchJob,
  stopMirrorBatchJob,
  type OnlineBeatmapSet,
} from "../../lib/api";
import {
  mirrorBeatmapSetDownloadUrl,
  osuWebBeatmapUrl,
} from "../../lib/osuUrls";

const SEARCH_KEY = "roxysu:download-maps-search";

type Mode = "any" | "osu" | "taiko" | "fruits" | "mania";
type Status =
  | "any"
  | "ranked"
  | "qualified"
  | "loved"
  | "pending"
  | "graveyard";
type Sort =
  | "ranked_desc"
  | "ranked_asc"
  | "plays_desc"
  | "favourites_desc"
  | "difficulty_desc"
  | "title_asc";

type StoredSearch = {
  q: string;
  mode: Mode;
  status: Status;
  sort: Sort;
  excludeOwned: boolean;
  page: number;
  noVideo: boolean;
  pageCount: number;
};

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "mania", label: "Mania" },
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "any", label: "Any mode" },
];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "ranked", label: "Ranked" },
  { value: "loved", label: "Loved" },
  { value: "qualified", label: "Qualified" },
  { value: "pending", label: "Pending" },
  { value: "graveyard", label: "Graveyard" },
  { value: "any", label: "Any status" },
];

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "ranked_desc", label: "Recently ranked" },
  { value: "plays_desc", label: "Most played" },
  { value: "favourites_desc", label: "Most favourited" },
  { value: "difficulty_desc", label: "Hardest" },
  { value: "title_asc", label: "Title A–Z" },
  { value: "ranked_asc", label: "Oldest ranked" },
];

const PAGE_COUNT_OPTIONS = [1, 2, 3, 5, 10] as const;

/** Splits pasted text on commas/whitespace/newlines into positive beatmapset ids. */
function parseIdList(raw: string): number[] {
  const ids = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => Number(token))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  return [...new Set(ids)];
}

function isMode(value: unknown): value is Mode {
  return MODE_OPTIONS.some((o) => o.value === value);
}
function isStatus(value: unknown): value is Status {
  return STATUS_OPTIONS.some((o) => o.value === value);
}
function isSort(value: unknown): value is Sort {
  return SORT_OPTIONS.some((o) => o.value === value);
}

function readStored(): StoredSearch {
  const defaults: StoredSearch = {
    q: "",
    mode: "mania",
    status: "ranked",
    sort: "ranked_desc",
    excludeOwned: true,
    page: 0,
    noVideo: true,
    pageCount: 3,
  };
  try {
    const raw = localStorage.getItem(SEARCH_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredSearch>;
    const pageCount =
      typeof parsed.pageCount === "number" &&
      PAGE_COUNT_OPTIONS.includes(
        parsed.pageCount as (typeof PAGE_COUNT_OPTIONS)[number],
      )
        ? parsed.pageCount
        : defaults.pageCount;
    return {
      q: typeof parsed.q === "string" ? parsed.q : defaults.q,
      mode: isMode(parsed.mode) ? parsed.mode : defaults.mode,
      status: isStatus(parsed.status) ? parsed.status : defaults.status,
      sort: isSort(parsed.sort) ? parsed.sort : defaults.sort,
      excludeOwned:
        typeof parsed.excludeOwned === "boolean"
          ? parsed.excludeOwned
          : defaults.excludeOwned,
      page:
        typeof parsed.page === "number" && parsed.page >= 0
          ? Math.floor(parsed.page)
          : defaults.page,
      noVideo:
        typeof parsed.noVideo === "boolean" ? parsed.noVideo : defaults.noVideo,
      pageCount,
    };
  } catch {
    return defaults;
  }
}

function persist(state: StoredSearch) {
  try {
    localStorage.setItem(SEARCH_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

/** Approximate osu! difficulty color bands, for small star-rating dots on cards. */
function starDotColor(stars: number): string {
  if (stars < 2) return "bg-lime-400";
  if (stars < 2.7) return "bg-sky-400";
  if (stars < 4) return "bg-amber-400";
  if (stars < 5.3) return "bg-pink-400";
  if (stars < 6.5) return "bg-violet-400";
  return "bg-rose-500";
}

function formatStars(stars: number): string {
  return `${stars.toFixed(2)}★`;
}

function difficultySummary(set: OnlineBeatmapSet): string {
  if (set.beatmaps.length === 0) return "No difficulties";
  const stars = set.beatmaps.map((b) => b.stars);
  const min = Math.min(...stars);
  const max = Math.max(...stars);
  const keys = [
    ...new Set(
      set.beatmaps
        .map((b) => b.keys)
        .filter((k): k is number => k != null && k > 0),
    ),
  ].sort((a, b) => a - b);
  const range =
    min === max ? formatStars(min) : `${formatStars(min)}–${formatStars(max)}`;
  const keyPart =
    keys.length > 0 ? ` · ${keys.map((k) => `${k}K`).join(", ")}` : "";
  return `${set.beatmaps.length} diff${set.beatmaps.length === 1 ? "" : "s"} · ${range}${keyPart}`;
}

export function DownloadMapsPage() {
  const initial = readStored();
  const queryClient = useQueryClient();
  const [q, setQ] = useState(initial.q);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [status, setStatus] = useState<Status>(initial.status);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [excludeOwned, setExcludeOwned] = useState(initial.excludeOwned);
  const [noVideo, setNoVideo] = useState(initial.noVideo);
  const [page, setPage] = useState(initial.page);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState({
    q: initial.q,
    mode: initial.mode,
    status: initial.status,
    sort: initial.sort,
    excludeOwned: initial.excludeOwned,
    page: initial.page,
  });

  function commit(next: {
    q: string;
    mode: Mode;
    status: Status;
    sort: Sort;
    excludeOwned: boolean;
    page: number;
  }) {
    setSubmitted(next);
    persist({ ...next, noVideo, pageCount });
  }

  const query = useQuery({
    queryKey: ["mirrors", "search", submitted],
    queryFn: () =>
      fetchMirrorSearch({
        q: submitted.q || undefined,
        mode: submitted.mode,
        status: submitted.status,
        sort: submitted.sort,
        page: submitted.page,
        excludeOwned: submitted.excludeOwned,
      }),
  });

  const downloadDirQuery = useQuery({
    queryKey: ["mirrors", "download-dir"],
    queryFn: fetchMirrorDownloadDir,
  });

  const batchQuery = useQuery({
    queryKey: ["mirrors", "batch"],
    queryFn: fetchMirrorBatchJob,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  const startBatch = useMutation({
    mutationFn: () =>
      startMirrorBatchJob({
        q: submitted.q || undefined,
        mode: submitted.mode,
        status: submitted.status,
        sort: submitted.sort,
        startPage: submitted.page,
        pageCount,
        noVideo,
        excludeOwned: submitted.excludeOwned,
      }),
    onSuccess: (data) => {
      setBatchError(null);
      queryClient.setQueryData(["mirrors", "batch"], data);
    },
    onError: (err) => {
      setBatchError(err instanceof Error ? err.message : String(err));
    },
  });

  const stopBatch = useMutation({
    mutationFn: stopMirrorBatchJob,
    onSuccess: (data) => {
      queryClient.setQueryData(["mirrors", "batch"], data);
    },
  });

  const [checkIdsInput, setCheckIdsInput] = useState("");
  const checkMissing = useMutation({
    mutationFn: (ids: number[]) => checkMissingBeatmapsets(ids),
  });

  const items = query.data && "items" in query.data ? query.data.items : [];
  const ownedSkipped =
    query.data && "ownedSkipped" in query.data ? query.data.ownedSkipped : 0;
  const hasMore =
    query.data && "hasMore" in query.data ? query.data.hasMore : false;
  const provider =
    query.data && "provider" in query.data ? query.data.provider : null;
  const batch = batchQuery.data;
  const batchBusy =
    batch?.status === "running" || batch?.status === "stopping";
  const downloadDir = downloadDirQuery.data?.path ?? "~/Downloads/beatmaps";

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Download maps</PageTitle>
        <p className="rx-subtitle mt-2 max-w-2xl">
          Search online beatmapsets you don&apos;t already have. Batch download
          saves <code className="text-ink">.osz</code> files into{" "}
          <code className="text-ink">{downloadDir}</code> — open or drag them
          into osu!lazer to import.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = {
            q: q.trim(),
            mode,
            status,
            sort,
            excludeOwned,
            page: 0,
          };
          setPage(0);
          commit(next);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="rx-input min-w-0 flex-1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search… e.g. keys=7, stars>=5, artist, title'
            aria-label="Search online beatmaps"
          />
          <button type="submit" className="rx-btn-primary shrink-0">
            Search
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="rx-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            aria-label="Mode"
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rx-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            aria-label="Status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rx-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-muted">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeOwned}
              onChange={(e) => setExcludeOwned(e.target.checked)}
            />
            Hide maps I already own
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={noVideo}
              onChange={(e) => {
                const next = e.target.checked;
                setNoVideo(next);
                persist({
                  q,
                  mode,
                  status,
                  sort,
                  excludeOwned,
                  page,
                  noVideo: next,
                  pageCount,
                });
              }}
            />
            Download without video
          </label>
        </div>
      </form>

      <section className="rx-panel space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Pages from here
            <select
              className="rx-select"
              value={pageCount}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPageCount(next);
                persist({
                  q,
                  mode,
                  status,
                  sort,
                  excludeOwned,
                  page,
                  noVideo,
                  pageCount: next,
                });
              }}
              aria-label="Number of pages to batch download"
            >
              {PAGE_COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} page{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rx-btn-primary"
            disabled={batchBusy || startBatch.isPending || query.isLoading}
            onClick={() => startBatch.mutate()}
          >
            Download {pageCount} page{pageCount === 1 ? "" : "s"}
          </button>
          {batchBusy ? (
            <button
              type="button"
              className="rx-btn"
              disabled={stopBatch.isPending || batch?.status === "stopping"}
              onClick={() => stopBatch.mutate()}
            >
              {batch?.status === "stopping" ? "Stopping…" : "Stop"}
            </button>
          ) : null}
        </div>

        <p className="text-sm text-muted">
          Saves unowned sets from page {page + 1}
          {pageCount > 1 ? `–${page + pageCount}` : ""} into{" "}
          <code className="text-ink">{downloadDir}</code>. Existing files are
          skipped.
        </p>

        {batchError ? (
          <p className="text-sm text-rose-400">{batchError}</p>
        ) : null}

        {batch && batch.status !== "idle" ? (
          <div className="space-y-1 text-sm text-muted">
            <p>
              Batch: <span className="text-ink">{batch.status}</span>
              {" · "}
              {batch.downloaded}/{batch.queued || "?"} saved
              {batch.skippedExisting > 0
                ? ` · ${batch.skippedExisting} already on disk`
                : ""}
              {batch.skippedOwned > 0
                ? ` · hid ${batch.skippedOwned} owned`
                : ""}
              {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
            </p>
            {batch.currentTitle ? (
              <p className="truncate text-faint">
                Current: {batch.currentTitle}
                {batch.currentSetId != null ? ` (#${batch.currentSetId})` : ""}
              </p>
            ) : null}
            {batch.error ? (
              <p className="text-rose-400">{batch.error}</p>
            ) : null}
            {batch.recentErrors.length > 0 ? (
              <ul className="text-xs text-faint">
                {batch.recentErrors.slice(0, 3).map((err) => (
                  <li key={`${err.setId}-${err.error}`}>
                    #{err.setId}: {err.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rx-panel space-y-3 p-4">
        <div>
          <h2 className="font-semibold text-ink">Check specific IDs</h2>
          <p className="text-sm text-muted">
            Paste beatmapset IDs (from a mirror, a pack, or anywhere else) to
            see which ones you&apos;re missing — no search needed.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            className="rx-input min-w-0 flex-1"
            rows={2}
            value={checkIdsInput}
            onChange={(e) => setCheckIdsInput(e.target.value)}
            placeholder="e.g. 292301, 1012634 658127"
            aria-label="Beatmapset IDs to check"
          />
          <button
            type="button"
            className="rx-btn-primary shrink-0"
            disabled={checkMissing.isPending || parseIdList(checkIdsInput).length === 0}
            onClick={() => checkMissing.mutate(parseIdList(checkIdsInput))}
          >
            Check
          </button>
        </div>

        {checkMissing.isError ? (
          <p className="text-sm text-rose-400">
            {checkMissing.error instanceof Error
              ? checkMissing.error.message
              : "Check failed"}
          </p>
        ) : null}

        {checkMissing.data && "error" in checkMissing.data ? (
          <p className="text-sm text-rose-400">
            {String(checkMissing.data.error)}
          </p>
        ) : checkMissing.data ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted">
              {checkMissing.data.checked} checked ·{" "}
              {checkMissing.data.missing.length} missing ·{" "}
              {checkMissing.data.owned.length} already owned
            </p>
            {checkMissing.data.missing.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {checkMissing.data.missing.map((id) => {
                  const downloadUrl = mirrorBeatmapSetDownloadUrl(id, {
                    noVideo,
                  });
                  return (
                    <li
                      key={id}
                      className="rx-row inline-flex items-center gap-2"
                    >
                      <BeatmapCover
                        setOnlineId={id}
                        size="list"
                        className="h-8 w-8 shrink-0 rounded"
                        alt=""
                      />
                      <span className="text-ink">#{id}</span>
                      {downloadUrl ? (
                        <a
                          href={downloadUrl}
                          className="rx-btn-primary"
                          title="Download .osz from mirror — open or drag into osu!lazer to import"
                        >
                          Download
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted">You already own everything checked.</p>
            )}
          </div>
        ) : null}
      </section>

      {query.isLoading ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SkeletonBlock className="h-4 w-48" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
          <CardGridSkeleton count={6} />
        </div>
      ) : query.isError ? (
        <p className="text-rose-400">
          {query.error instanceof Error
            ? query.error.message
            : "Search failed"}
        </p>
      ) : query.data && "error" in query.data ? (
        <p className="text-rose-400">{String(query.data.error)}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
            <p>
              {items.length} result{items.length === 1 ? "" : "s"}
              {ownedSkipped > 0
                ? ` · hid ${ownedSkipped} you already own`
                : ""}
              {provider ? ` · via ${provider}` : ""}
            </p>
            <p className="text-faint">Page {page + 1}</p>
          </div>

          {items.length === 0 ? (
            <p className="text-muted">
              No unowned maps on this page. Try another query or next page.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((set) => (
                <li key={set.id}>
                  <OnlineSetCard set={set} noVideo={noVideo} />
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rx-btn"
              disabled={page <= 0 || query.isFetching}
              onClick={() => {
                const nextPage = Math.max(0, page - 1);
                setPage(nextPage);
                commit({ ...submitted, page: nextPage });
              }}
            >
              Previous
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={!hasMore || query.isFetching}
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                commit({ ...submitted, page: nextPage });
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OnlineSetCard({
  set,
  noVideo,
}: {
  set: OnlineBeatmapSet;
  noVideo: boolean;
}) {
  const downloadUrl = mirrorBeatmapSetDownloadUrl(set.id, { noVideo });
  const firstDiff = set.beatmaps[0];
  const webUrl =
    (firstDiff ? osuWebBeatmapUrl(firstDiff.id, set.id) : null) ??
    `https://osu.ppy.sh/beatmapsets/${set.id}`;

  const diffDots = set.beatmaps.slice(0, 6);
  const extraDiffs = set.beatmaps.length - diffDots.length;

  return (
    <div className="rx-card flex h-full flex-col">
      <div className="relative">
        <BeatmapCover
          setOnlineId={set.id}
          size="card"
          className="aspect-[2.2/1] w-full"
          alt=""
        />
        {set.hasVideo ? (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-ink backdrop-blur-sm">
            video
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="truncate text-sm text-muted">{set.artist}</div>
        <div className="truncate font-bold text-ink">{set.title}</div>
        <div className="mt-1 truncate text-xs text-muted">
          mapped by {set.creator}
          {" · "}
          {set.status}
          {set.bpm != null ? ` · ${Math.round(set.bpm)} BPM` : ""}
        </div>

        {diffDots.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {diffDots.map((diff) => (
              <span
                key={diff.id}
                title={`[${diff.version}] ${formatStars(diff.stars)}`}
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${starDotColor(diff.stars)}`}
              />
            ))}
            {extraDiffs > 0 ? (
              <span className="text-xs text-faint">+{extraDiffs}</span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-1 truncate text-xs text-faint">
          {difficultySummary(set)}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a href={webUrl} target="_blank" rel="noreferrer" className="rx-btn">
            Website
          </a>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="rx-btn-primary"
              title="Download .osz from mirror — open or drag into osu!lazer to import"
            >
              Download
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
