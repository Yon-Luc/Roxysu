import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { OnlineSetCard } from "../../components/OnlineSetCard";
import { SkeletonBlock, CardGridSkeleton } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import {
  countMirrorMissing,
  fetchMirrorDownloadDir,
  fetchMirrorSearch,
  openLastBatchInOsu,
  saveMirrorBeatmapset,
  startMirrorBatchJob,
  type MirrorBatchJob,
  type MirrorMissingCount,
  type OnlineBeatmapSet,
} from "../../lib/api";
import { DownloadSearchGrid } from "./DownloadSearchGrid";
import { pushToast } from "../../lib/toasts";
import {
  isDevUi,
} from "./batchProgress";
import { useAppDict, t } from "../../lib/i18n";
import { DownloadSessionPanel } from "./DownloadSessionPanel";
import {
  startFakeMirrorBatch,
  type FakeDownloadPreset,
} from "./fakeMirrorBatch";
import {
  MIRROR_BATCH_QUERY_KEY,
  useMirrorBatchJob,
} from "./useMirrorBatchJob";

const SEARCH_KEY = "roxysu:download-maps-search-v2";

type Sort =
  | "ranked_desc"
  | "ranked_asc"
  | "plays_desc"
  | "favourites_desc"
  | "difficulty_desc"
  | "title_asc";

type StoredSearch = {
  q: string;
  sort: Sort;
  excludeOwned: boolean;
  noVideo: boolean;
  pageCount: number;
  downloadConcurrency: number;
};

const SORT_OPTIONS: Sort[] = [
  "ranked_desc",
  "plays_desc",
  "favourites_desc",
  "difficulty_desc",
  "title_asc",
  "ranked_asc",
];

const SORT_LABEL_FALLBACK: Record<Sort, string> = {
  ranked_desc: "Recently ranked",
  plays_desc: "Most played",
  favourites_desc: "Most favourited",
  difficulty_desc: "Hardest",
  title_asc: "Title A–Z",
  ranked_asc: "Oldest ranked",
};

const PAGE_COUNT_OPTIONS = [1, 2, 3, 5, 10] as const;

function isSort(value: unknown): value is Sort {
  return SORT_OPTIONS.includes(value as Sort);
}

function readStored(): StoredSearch {
  const defaults: StoredSearch = {
    q: "key=7 status=r",
    sort: "ranked_desc",
    excludeOwned: true,
    noVideo: true,
    pageCount: 3,
    downloadConcurrency: 3,
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
    const downloadConcurrency =
      typeof parsed.downloadConcurrency === "number" &&
      parsed.downloadConcurrency >= 1 &&
      parsed.downloadConcurrency <= 10
        ? Math.floor(parsed.downloadConcurrency)
        : defaults.downloadConcurrency;
    return {
      q: typeof parsed.q === "string" ? parsed.q : defaults.q,
      sort: isSort(parsed.sort) ? parsed.sort : defaults.sort,
      excludeOwned:
        typeof parsed.excludeOwned === "boolean"
          ? parsed.excludeOwned
          : defaults.excludeOwned,
      noVideo:
        typeof parsed.noVideo === "boolean" ? parsed.noVideo : defaults.noVideo,
      pageCount,
      downloadConcurrency,
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

export function DownloadMapsPage() {
  const { dict } = useAppDict();
  const [initial] = useState(readStored);

  const sortLabel = (value: Sort): string => {
    switch (value) {
      case "ranked_desc":
        return dict?.download?.sortLabels?.recentlyRanked ?? "Recently ranked";
      case "plays_desc":
        return dict?.download?.sortLabels?.mostPlayed ?? "Most played";
      case "favourites_desc":
        return dict?.download?.sortLabels?.mostFavourited ?? "Most favourited";
      case "difficulty_desc":
        return dict?.download?.sortLabels?.hardest ?? "Hardest";
      case "title_asc":
        return dict?.download?.sortLabels?.titleAZ ?? "Title A–Z";
      case "ranked_asc":
        return dict?.download?.sortLabels?.oldestRanked ?? "Oldest ranked";
    }
  };
  const queryClient = useQueryClient();
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [excludeOwned, setExcludeOwned] = useState(initial.excludeOwned);
  const [noVideo, setNoVideo] = useState(initial.noVideo);
  const [downloadConcurrency, setDownloadConcurrency] = useState(initial.downloadConcurrency);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState({
    q: initial.q,
    sort: initial.sort,
    excludeOwned: initial.excludeOwned,
  });

  const {
    batch,
    busy: batchBusy,
    phase: batchPhase,
    processed: batchProcessed,
    progressPct: downloadProgressPct,
    eta,
    stopBatch,
    isFake,
  } = useMirrorBatchJob();

  function commit(next: {
    q: string;
    sort: Sort;
    excludeOwned: boolean;
  }) {
    setSubmitted(next);
    persist({ ...next, noVideo, pageCount, downloadConcurrency });
  }

  const query = useInfiniteQuery({
    queryKey: ["mirrors", "search", submitted],
    queryFn: ({ pageParam }) =>
      fetchMirrorSearch({
        query: submitted.q,
        sort: submitted.sort,
        page: pageParam,
        excludeOwned: submitted.excludeOwned,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (!lastPage || "error" in lastPage) return undefined;
      return lastPage.hasMore ? lastPageParam + 1 : undefined;
    },
  });

  const downloadDirQuery = useQuery({
    queryKey: ["mirrors", "download-dir"],
    queryFn: fetchMirrorDownloadDir,
  });

  function onStartBatchError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Race: another start won, or UI missed busy state — adopt the running job.
    if (/already running/i.test(message)) {
      setBatchError(null);
      void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
      return;
    }
    setBatchError(message);
  }

  const startPagesBatch = useMutation({
    mutationFn: () =>
      startMirrorBatchJob({
        mode: "pages",
        query: submitted.q,
        sort: submitted.sort,
        startPage: 0,
        pageCount,
        noVideo,
        excludeOwned: submitted.excludeOwned,
        downloadConcurrency,
      }),
    onSuccess: (data) => {
      setBatchError(null);
      queryClient.setQueryData(MIRROR_BATCH_QUERY_KEY, data);
    },
    onError: onStartBatchError,
  });

  const startQueryBatch = useMutation({
    mutationFn: () =>
      startMirrorBatchJob({
        mode: "query",
        query: submitted.q,
        sort: submitted.sort,
        noVideo,
        excludeOwned: true,
        downloadConcurrency,
      }),
    onSuccess: (data) => {
      setBatchError(null);
      queryClient.setQueryData(MIRROR_BATCH_QUERY_KEY, data);
    },
    onError: onStartBatchError,
  });

  const [missingCount, setMissingCount] = useState<MirrorMissingCount | null>(
    null,
  );
  const [countError, setCountError] = useState<string | null>(null);

  const countMissing = useMutation({
    mutationFn: () =>
      countMirrorMissing({
        query: submitted.q,
        sort: submitted.sort,
        excludeOwned: true,
      }),
    onSuccess: (data) => {
      if ("error" in data) {
        setMissingCount(null);
        setCountError(String(data.error));
        return;
      }
      setCountError(null);
      setMissingCount(data);
    },
    onError: (err) => {
      setMissingCount(null);
      setCountError(err instanceof Error ? err.message : String(err));
    },
  });

  const [openInOsuMessage, setOpenInOsuMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  /** Immediate UI signal so Open in osu! enables without waiting on a refetch. */
  const [readyToOpenCount, setReadyToOpenCount] = useState(0);
  /** Set IDs downloaded this session — hide from results until search refetches. */
  const [pendingDownloadIds, setPendingDownloadIds] = useState<Set<number>>(
    () => new Set(),
  );

  const openInOsu = useMutation({
    mutationFn: openLastBatchInOsu,
    onSuccess: (data) => {
      setBatchError(null);
      if ("savedForImport" in data && typeof data.savedForImport === "number") {
        setReadyToOpenCount(data.savedForImport);
      }
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string" &&
        (data as { error: string }).error.length > 0
      ) {
        setOpenInOsuMessage((data as { error: string }).error);
        void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
        return;
      }
      if (!("opened" in data)) {
        setOpenInOsuMessage(
          dict?.download?.openFailed ?? "Open in osu! failed",
        );
        void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
        return;
      }
      if (
        "message" in data &&
        typeof data.message === "string" &&
        data.message.length > 0
      ) {
        setOpenInOsuMessage(data.message);
      } else if (data.opened === 0 && data.savedForImport === 0) {
        setOpenInOsuMessage(
          dict?.download?.noOszLeft ??
            "No .osz archives left in the download folder — ready-to-open list cleared.",
        );
      } else {
        const openedMsg =
          t(dict?.download?.openedArchives, {
            opened: data.opened,
            s: data.opened === 1 ? "" : "s",
          }) ||
          `Opened ${data.opened} archive${data.opened === 1 ? "" : "s"} in osu!`;
        const failedMsg =
          data.failed > 0
            ? t(dict?.download?.failedPart, { failed: data.failed }) ||
              ` (${data.failed} failed)`
            : "";
        const stillMsg =
          data.savedForImport === 0
            ? dict?.download?.importing ??
              " · osu! is importing (task count is per difficulty, not per set)"
            : t(dict?.download?.stillToOpen, {
                saved: data.savedForImport,
              }) || ` · ${data.savedForImport} still to open`;
        const dontClickMsg =
          dict?.download?.dontClick ??
          ". Don't click Open again while tasks are running.";
        setOpenInOsuMessage(openedMsg + failedMsg + stillMsg + dontClickMsg);
      }
      void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
    },
    onError: (err) => {
      setOpenInOsuMessage(err instanceof Error ? err.message : String(err));
      void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
      setReadyToOpenCount(0);
    },
  });

  const saveSet = useMutation({
    mutationFn: (args: {
      setId: number;
      artist?: string;
      title?: string;
    }) =>
      saveMirrorBeatmapset({
        setId: args.setId,
        artist: args.artist,
        title: args.title,
        noVideo,
      }),
    onSuccess: (data) => {
      setBatchError(null);
      if (typeof data.error === "string" && data.error.length > 0) {
        setSaveMessage(data.error);
        return;
      }
      if (!("result" in data) || !("savedForImport" in data)) {
        setSaveMessage(dict?.download?.saveFailed ?? "Save failed");
        return;
      }
      setSaveMessage(
        data.result === "exists"
          ? t(dict?.download?.saveExists, { id: data.setId }) ||
            `#${data.setId} already on disk — ready to open in osu!`
          : t(dict?.download?.saveSaved, { id: data.setId }) ||
            `#${data.setId} saved — ready to open in osu!`,
      );
      setReadyToOpenCount(data.savedForImport);
      setPendingDownloadIds((prev) => {
        const next = new Set(prev);
        next.add(data.setId);
        return next;
      });
      const {
        setId: _setId,
        result: _result,
        path: _path,
        ...batchState
      } = data;
      queryClient.setQueryData(
        MIRROR_BATCH_QUERY_KEY,
        batchState as MirrorBatchJob,
      );
    },
    onError: (err) => {
      setSaveMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const pages = query.data?.pages ?? [];
  const pageError = pages.find(
    (page) => page && typeof page === "object" && "error" in page,
  );
  const { rawItems, ownedSkipped, pendingSkipped, provider } = useMemo(() => {
    const seen = new Set<number>();
    const items: OnlineBeatmapSet[] = [];
    let owned = 0;
    let pending = 0;
    let via: string | null = null;
    for (const page of pages) {
      if (!page || "error" in page) continue;
      owned += Number(page.ownedSkipped) || 0;
      pending += Number(page.pendingSkipped) || 0;
      if (page.provider) via = page.provider;
      for (const set of page.items) {
        if (seen.has(set.id)) continue;
        seen.add(set.id);
        items.push(set);
      }
    }
    return {
      rawItems: items,
      ownedSkipped: owned,
      pendingSkipped: pending,
      provider: via,
    };
  }, [pages]);
  const hasMore = query.hasNextPage === true;
  const items =
    submitted.excludeOwned && pendingDownloadIds.size > 0
      ? rawItems.filter((set) => !pendingDownloadIds.has(set.id))
      : rawItems;
  const hiddenPendingLocal =
    submitted.excludeOwned && pendingDownloadIds.size > 0
      ? rawItems.length - items.length
      : 0;
  const downloadDir = downloadDirQuery.data?.path ?? "~/Downloads/beatmaps";
  const canDownloadAllMissing =
    submitted.excludeOwned &&
    (items.length > 0 || hasMore) &&
    !batchBusy &&
    !query.isLoading;
  const savedForImport = Math.max(
    readyToOpenCount,
    batch && "savedForImport" in batch ? Number(batch.savedForImport) || 0 : 0,
  );
  const canOpenInOsu = !batchBusy && savedForImport > 0;
  const canCountMissing =
    submitted.excludeOwned &&
    !batchBusy &&
    !query.isLoading &&
    !countMissing.isPending;
  const missingActionsDisabledReason = !submitted.excludeOwned
    ? dict?.download?.missingEnabledReason ??
      "Enable “Hide maps I already own” to count or download missing maps"
    : batchBusy
      ? dict?.download?.missingBatchBusyReason ??
        "Wait for the current batch to finish or stop it"
      : query.isLoading
        ? dict?.download?.missingSearchingReason ?? "Wait for search to finish"
        : null;
  const showDevTools = isDevUi();

  useEffect(() => {
    setMissingCount(null);
    setCountError(null);
    setPendingDownloadIds(new Set());
  }, [submitted.q, submitted.sort, submitted.excludeOwned]);

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  useEffect(() => {
    if (
      batch &&
      "savedForImport" in batch &&
      typeof batch.savedForImport === "number"
    ) {
      setReadyToOpenCount(batch.savedForImport);
    }
  }, [batch]);

  useEffect(() => {
    if (batch?.status === "completed" && !isFake) {
      setMissingCount(null);
      void queryClient.invalidateQueries({ queryKey: ["mirrors", "search"] });
    }
  }, [batch?.status, isFake, queryClient]);

  function runFake(preset: FakeDownloadPreset) {
    try {
      startFakeMirrorBatch({
        preset,
        count: preset === "fast" ? 40 : preset === "fail" ? 24 : 20,
      });
      setBatchError(null);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>{dict?.download?.pageTitle ?? "Download maps"}</PageTitle>
        <p className="rx-subtitle mt-2 max-w-2xl">
          {dict?.download?.subtitle1 ??
            "Search online with the same query language as Practice — then download every missing set that matches. Downloads (single or batch) save"}{" "}
          <code className="text-ink">.osz</code>{" "}
          {dict?.download?.subtitle2 ?? "files into"}{" "}
          <code className="text-ink">{downloadDir}</code>.{" "}
          {dict?.download?.subtitle3 ?? "Use"}{" "}
          <span className="font-medium text-ink">
            {dict?.download?.openInOsu ?? "Open in osu!"}
          </span>{" "}
          {dict?.download?.subtitle4 ?? "to import them into osu!lazer."}
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          commit({
            q,
            sort,
            excludeOwned,
          });
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
            <span className="flex items-center gap-2">
              {dict?.download?.queryLabel ?? "Query"}
              <QueryLanguageHelpButton />
            </span>
            <input
              className="rx-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="key=7 status=r"
              aria-label={dict?.download?.queryAria ?? "Beatmap search query"}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {dict?.download?.sortLabel ?? "Sort"}
            <select
              className="rx-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label={dict?.download?.sortAria ?? "Sort order"}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {sortLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rx-btn-primary shrink-0">
            {dict?.download?.search ?? "Search"}
          </button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={excludeOwned}
              onChange={(e) => {
                const next = e.target.checked;
                setExcludeOwned(next);
                // Count/Download-all-missing gate on submitted.excludeOwned —
                // commit immediately so the buttons don't stay stuck disabled
                // until the user remembers to click Search.
                commit({
                  q: submitted.q,
                  sort: submitted.sort,
                  excludeOwned: next,
                });
              }}
            />
            {dict?.download?.hideOwned ?? "Hide maps I already own"}
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
                  sort,
                  excludeOwned,
                  noVideo: next,
                  pageCount,
                  downloadConcurrency,
                });
              }}
            />
            {dict?.download?.noVideo ?? "Download without video"}
          </label>
          <label className="inline-flex items-center gap-2">
            <span className="text-muted">
              {dict?.download?.parallelDownloads ?? "Parallel downloads:"}
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={downloadConcurrency}
              onChange={(e) => {
                const next = Math.min(10, Math.max(1, Math.floor(Number(e.target.value))));
                setDownloadConcurrency(next);
                persist({ q, sort, excludeOwned, noVideo, pageCount, downloadConcurrency: next });
              }}
              className="w-12 rounded border border-subtle bg-surface px-1 py-0.5 text-center text-sm"
              aria-label={
                dict?.download?.parallelAria ??
                "Number of maps to download in parallel (1–10)"
              }
            />
            <span className="text-muted text-xs">
              {dict?.download?.parallelRange ?? "(1–10)"}
            </span>
          </label>
        </div>
      </form>

      {batchBusy && batch ? (
        <DownloadSessionPanel
          batch={batch}
          phase={batchPhase}
          processed={batchProcessed}
          progressPct={downloadProgressPct}
          eta={eta}
          stopping={stopBatch.isPending}
          onStop={() => stopBatch.mutate()}
        />
      ) : (
        <section className="rx-panel space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              className="rx-btn"
              disabled={!canCountMissing}
              onClick={() => countMissing.mutate()}
              title={
                missingActionsDisabledReason ??
                (dict?.download?.countTitle ??
                  "Count missing sets (uses hub search cache when primed, otherwise crawls the mirror)")
              }
            >
              {countMissing.isPending
                ? dict?.download?.counting ?? "Counting…"
                : dict?.download?.countAllMissing ?? "Count all missing"}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!canDownloadAllMissing || startQueryBatch.isPending}
              onClick={() => startQueryBatch.mutate()}
              title={
                missingActionsDisabledReason ??
                (!canDownloadAllMissing && submitted.excludeOwned
                  ? dict?.download?.noMissingTitle ??
                    "No missing maps in these results — try another query or Count all missing"
                  : dict?.download?.crawlTitle ??
                    "Crawl the mirror for every missing set matching this query")
              }
            >
              {missingCount
                ? t(dict?.download?.downloadAllMissingCount, {
                    count: missingCount.matched.toLocaleString(),
                    plus: missingCount.hitCap ? "+" : "",
                  }) ||
                  `Download all missing (${missingCount.matched.toLocaleString()}${missingCount.hitCap ? "+" : ""})`
                : dict?.download?.downloadAllMissing ?? "Download all missing"}
            </button>
            <label className="flex flex-col gap-1 text-sm text-muted">
              {dict?.download?.orPagesFromStart ?? "Or pages from the start"}
              <select
                className="rx-select"
                value={pageCount}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPageCount(next);
                  persist({
                    q,
                    sort,
                    excludeOwned,
                    noVideo,
                    pageCount: next,
                    downloadConcurrency,
                  });
                }}
                aria-label={
                  dict?.download?.pagesFromStartAria ??
                  "Number of pages to batch download"
                }
              >
                {PAGE_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {t(dict?.download?.pagesOption, {
                      n,
                      s: n === 1 ? "" : "s",
                    }) || `${n} page${n === 1 ? "" : "s"}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rx-btn"
              disabled={
                batchBusy || startPagesBatch.isPending || query.isLoading
              }
              onClick={() => startPagesBatch.mutate()}
            >
              {t(dict?.download?.downloadPages, {
                n: pageCount,
                s: pageCount === 1 ? "" : "s",
              }) || `Download ${pageCount} page${pageCount === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!canOpenInOsu || openInOsu.isPending}
              onClick={() => {
                setOpenInOsuMessage(null);
                openInOsu.mutate();
              }}
              title={
                dict?.download?.openInOsuTitle ??
                "Open saved .osz files with osu!lazer (also writes import-into-osu.sh / .bat)"
              }
            >
              {openInOsu.isPending
                ? dict?.download?.opening ?? "Opening…"
                : savedForImport > 0
                  ? t(dict?.download?.openInOsuCount, {
                      n: savedForImport,
                    }) || `Open in osu! (${savedForImport})`
                  : dict?.download?.openInOsu ?? "Open in osu!"}
            </button>
          </div>

          <p className="text-sm text-muted">
            {dict?.download?.scrollHint ?? "Search loads more as you scroll."}{" "}
            <span className="font-medium text-ink">
              {dict?.download?.countAllMissing ?? "Count all missing"}
            </span>{" "}
            {dict?.download?.totalsFor ?? "totals the result for"}{" "}
            <code className="text-ink">{submitted.q || "(defaults)"}</code>{" "}
            {dict?.download?.minusOwned ??
              "minus owned maps (hub search cache when primed, otherwise a mirror crawl) so you know the real total before"}{" "}
            <span className="font-medium text-ink">
              {dict?.download?.downloadAllMissing ?? "Download all missing"}
            </span>
            .{" "}
            {dict?.download?.broadInstant ??
              "Broad ranked/loved counts on hinai are usually instant; filters like"}{" "}
            <code className="text-ink">key=7</code>{" "}
            {dict?.download?.crawlPages ??
              "still crawl mirror pages (capped). Files go to the shared folder; then use"}{" "}
            <span className="font-medium text-ink">
              {dict?.download?.openInOsu ?? "Open in osu!"}
            </span>{" "}
            {dict?.download?.orUse ?? "or"}{" "}
            <code className="text-ink">import-into-osu.sh</code> /{" "}
            <code className="text-ink">import-into-osu.bat</code>.
          </p>

          {countError ? (
            <p className="text-sm text-danger">{countError}</p>
          ) : null}
          {missingCount ? (
            <p className="text-sm text-muted">
              {dict?.download?.countLabel ?? "Count:"}{" "}
              <span className="font-medium text-ink">
                {missingCount.matched.toLocaleString()}
              </span>{" "}
              {dict?.download?.missing ?? "missing"}
              {missingCount.ownedSkipped > 0
                ? t(dict?.download?.hidOwned, {
                    count: missingCount.ownedSkipped.toLocaleString(),
                  }) || ` · hid ${missingCount.ownedSkipped.toLocaleString()} owned/pending`
                : ""}
              {" · "}
              {t(dict?.download?.pagesScanned, {
                count: missingCount.pagesScanned,
                s: missingCount.pagesScanned === 1 ? "" : "s",
              }) || `${missingCount.pagesScanned} page${missingCount.pagesScanned === 1 ? "" : "s"} scanned`}
              {missingCount.hitCap
                ? t(dict?.download?.safetyCap, {
                    pages: missingCount.cappedAt.maxPages,
                    sets: missingCount.cappedAt.maxSets.toLocaleString(),
                  }) ||
                  ` · hit safety cap (${missingCount.cappedAt.maxPages} pages / ${missingCount.cappedAt.maxSets.toLocaleString()} sets)`
                : ""}
            </p>
          ) : null}
          {countMissing.isPending ? (
            <p className="text-sm text-muted">
              {dict?.download?.countingMissing ??
                "Counting missing maps… broad ranked/loved queries are usually instant; post-filters like"}{" "}
              <code className="text-ink">key=7 status=r</code>{" "}
              {dict?.download?.countingMissingTail ?? "may still crawl mirror pages."}
            </p>
          ) : null}

          {batchError ? (
            <p className="text-sm text-danger">{batchError}</p>
          ) : null}
          {saveMessage ? (
            <p className="text-sm text-muted">{saveMessage}</p>
          ) : null}
          {openInOsuMessage ? (
            <p className="text-sm text-muted">{openInOsuMessage}</p>
          ) : null}

          {batch && batch.status !== "idle" ? (
            <div className="space-y-2 text-sm text-muted">
              <p>
                {dict?.download?.batchLabel ?? "Batch:"}{" "}
                <span className="text-ink">{batch.status}</span>
                {" · "}
                {batch.mode}
                {" · "}
                {t(dict?.download?.saved, {
                  saved: batch.downloaded,
                  queued: batch.queued || "?",
                }) || `${batch.downloaded}/${batch.queued || "?"} saved`}
                {batch.matched > 0
                  ? t(dict?.download?.matched, {
                      count: batch.matched.toLocaleString(),
                    }) || ` · ${batch.matched.toLocaleString()} matched`
                  : ""}
                {batch.pagesScanned > 0
                  ? t(dict?.download?.pagesScannedBatch, {
                      count: batch.pagesScanned,
                    }) || ` · ${batch.pagesScanned} pages scanned`
                  : ""}
                {batch.hitCap
                  ? ` · ${dict?.download?.safetyCapBatch ?? "hit safety cap"}`
                  : ""}
                {batch.skippedExisting > 0
                  ? t(dict?.download?.skippedExisting, {
                      count: batch.skippedExisting,
                    }) || ` · ${batch.skippedExisting} already on disk`
                  : ""}
                {batch.skippedOwned > 0
                  ? t(dict?.download?.hidOwnedBatch, {
                      count: batch.skippedOwned,
                    }) || ` · hid ${batch.skippedOwned} owned`
                  : ""}
                {batch.failed > 0
                  ? t(dict?.download?.failedBatch, {
                      count: batch.failed,
                    }) || ` · ${batch.failed} failed`
                  : ""}
                {savedForImport > 0
                  ? t(dict?.download?.readyToOpen, {
                      count: savedForImport,
                    }) || ` · ${savedForImport} ready to open`
                  : ""}
              </p>
              {batch.query ? (
                <p className="truncate text-faint">
                  {dict?.download?.batchQueryLabel ?? "Query:"} {batch.query}
                </p>
              ) : null}
              {batch.error ? (
                <p className="text-danger">{batch.error}</p>
              ) : null}
              {batch.importScriptSh || batch.importScriptBat ? (
                <p className="truncate text-faint">
                  {dict?.download?.importScripts ?? "Import scripts:"}{" "}
                  {batch.importScriptSh
                    ? batch.importScriptSh.split(/[/\\]/).pop()
                    : null}
                  {batch.importScriptSh && batch.importScriptBat ? " / " : null}
                  {batch.importScriptBat
                    ? batch.importScriptBat.split(/[/\\]/).pop()
                    : null}
                </p>
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
      )}

      {showDevTools ? (
        <section className="rx-panel space-y-3 border border-dashed border-warning/40 p-4">
          <div>
            <h2 className="font-semibold text-ink">
              {dict?.download?.devTitle ?? "Dev · download UI"}
            </h2>
            <p className="text-sm text-muted">
              {dict?.download?.devDesc ??
                "Client-only fake jobs — no mirror traffic, no"}{" "}
              <code className="text-ink">.osz</code>{" "}
              {dict?.download?.devDesc2 ??
                "writes. Use these to try the session view, floating chip, ETA, and completion toast."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("fast")}
            >
              {dict?.download?.fakeFast ?? "Fake fast (40)"}
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("realistic")}
            >
              {dict?.download?.fakeRealistic ?? "Fake realistic (20)"}
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("fail")}
            >
              {dict?.download?.fakeFail ?? "Fake fail mid-way"}
            </button>
            <button
              type="button"
              className="rx-btn"
              onClick={() =>
                pushToast({
                  title: dict?.download?.toastTitle ?? "Download finished",
                  detail: dict?.download?.toastDetail ?? "12 maps saved (dev toast)",
                  tone: "success",
                })
              }
            >
              {dict?.download?.testToast ?? "Test completion toast"}
            </button>
          </div>
        </section>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SkeletonBlock className="h-4 w-48" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
          <CardGridSkeleton count={6} />
        </div>
      ) : query.isError ? (
        <p className="text-danger">
          {query.error instanceof Error
            ? query.error.message
            : dict?.download?.searchFailed ?? "Search failed"}
        </p>
      ) : pageError && "error" in pageError ? (
        <p className="text-danger">{String(pageError.error)}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
            <p>
              {t(dict?.download?.resultsCount, {
                count: items.length,
                s: items.length === 1 ? "" : "s",
              }) || `${items.length} result${items.length === 1 ? "" : "s"}`}
              {ownedSkipped > 0
                ? t(dict?.download?.hidOwnedResults, {
                    count: ownedSkipped,
                  }) || ` · hid ${ownedSkipped} you already own`
                : ""}
              {pendingSkipped + hiddenPendingLocal > 0
                ? t(dict?.download?.hidRecent, {
                    count: pendingSkipped + hiddenPendingLocal,
                  }) ||
                  ` · hid ${pendingSkipped + hiddenPendingLocal} recently downloaded`
                : ""}
              {provider
                ? t(dict?.download?.viaProvider, { provider }) ||
                  ` · via ${provider}`
                : ""}
            </p>
            <p className="text-faint">
              {hasMore
                ? dict?.download?.scrollForMore ?? "Scroll for more"
                : items.length > 0
                  ? dict?.download?.endOfResults ?? "End of results"
                  : ""}
            </p>
          </div>

          {items.length === 0 ? (
            <p className="text-muted">
              {dict?.download?.noUnowned ??
                "No unowned maps for this search. Try another query."}
            </p>
          ) : (
            <DownloadSearchGrid
              items={items}
              hasMore={hasMore}
              fetchingMore={query.isFetchingNextPage}
              onNearEnd={loadMore}
              renderItem={(set) => (
                <OnlineSetCard
                  set={set}
                  actions={
                    <button
                      type="button"
                      className="rx-btn-primary"
                      disabled={batchBusy || saveSet.isPending}
                      title={
                        dict?.download?.saveCardTitle ??
                        "Save .osz into the shared beatmaps download folder"
                      }
                      onClick={() =>
                        saveSet.mutate({
                          setId: set.id,
                          artist: set.artist,
                          title: set.title,
                        })
                      }
                    >
                      {saveSet.isPending &&
                      saveSet.variables?.setId === set.id
                        ? dict?.download?.saving ?? "Saving…"
                        : dict?.download?.downloadCard ?? "Download"}
                    </button>
                  }
                />
              )}
            />
          )}

          {query.isFetchingNextPage ? (
            <p className="text-sm text-muted">
              {dict?.download?.loadingMore ?? "Loading more…"}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
