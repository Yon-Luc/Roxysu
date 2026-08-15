import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "../../lib/api";
import { pushToast } from "../../lib/toasts";
import {
  isDevUi,
} from "./batchProgress";
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
  page: number;
  noVideo: boolean;
  pageCount: number;
  downloadConcurrency: number;
};

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "ranked_desc", label: "Recently ranked" },
  { value: "plays_desc", label: "Most played" },
  { value: "favourites_desc", label: "Most favourited" },
  { value: "difficulty_desc", label: "Hardest" },
  { value: "title_asc", label: "Title A–Z" },
  { value: "ranked_asc", label: "Oldest ranked" },
];

const PAGE_COUNT_OPTIONS = [1, 2, 3, 5, 10] as const;

function isSort(value: unknown): value is Sort {
  return SORT_OPTIONS.some((o) => o.value === value);
}

function readStored(): StoredSearch {
  const defaults: StoredSearch = {
    q: "key=7 status=r",
    sort: "ranked_desc",
    excludeOwned: true,
    page: 0,
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
      page:
        typeof parsed.page === "number" && parsed.page >= 0
          ? Math.floor(parsed.page)
          : defaults.page,
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
  const initial = readStored();
  const queryClient = useQueryClient();
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [excludeOwned, setExcludeOwned] = useState(initial.excludeOwned);
  const [noVideo, setNoVideo] = useState(initial.noVideo);
  const [downloadConcurrency, setDownloadConcurrency] = useState(initial.downloadConcurrency);
  const [page, setPage] = useState(initial.page);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState({
    q: initial.q,
    sort: initial.sort,
    excludeOwned: initial.excludeOwned,
    page: initial.page,
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
    page: number;
  }) {
    setSubmitted(next);
    persist({ ...next, noVideo, pageCount, downloadConcurrency });
  }

  const query = useQuery({
    queryKey: ["mirrors", "search", submitted],
    queryFn: () =>
      fetchMirrorSearch({
        query: submitted.q,
        sort: submitted.sort,
        page: submitted.page,
        excludeOwned: submitted.excludeOwned,
      }),
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
        startPage: submitted.page,
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
        setOpenInOsuMessage("Open in osu! failed");
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
          "No .osz archives left in the download folder — ready-to-open list cleared.",
        );
      } else {
        setOpenInOsuMessage(
          `Opened ${data.opened} archive${data.opened === 1 ? "" : "s"} in osu!` +
            (data.failed > 0 ? ` (${data.failed} failed)` : "") +
            (data.savedForImport === 0
              ? " · osu! is importing (task count is per difficulty, not per set)"
              : ` · ${data.savedForImport} still to open`) +
            ". Don't click Open again while tasks are running.",
        );
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
        setSaveMessage("Save failed");
        return;
      }
      setSaveMessage(
        data.result === "exists"
          ? `#${data.setId} already on disk — ready to open in osu!`
          : `#${data.setId} saved — ready to open in osu!`,
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
      void queryClient.invalidateQueries({ queryKey: ["mirrors", "search"] });
    },
    onError: (err) => {
      setSaveMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const rawItems = query.data && "items" in query.data ? query.data.items : [];
  const ownedSkipped =
    query.data && "ownedSkipped" in query.data ? query.data.ownedSkipped : 0;
  const pendingSkipped =
    query.data && "pendingSkipped" in query.data
      ? Number(query.data.pendingSkipped) || 0
      : 0;
  const hasMore =
    query.data && "hasMore" in query.data ? query.data.hasMore : false;
  const provider =
    query.data && "provider" in query.data ? query.data.provider : null;
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
    ? "Enable “Hide maps I already own” to count or download missing maps"
    : batchBusy
      ? "Wait for the current batch to finish or stop it"
      : query.isLoading
        ? "Wait for search to finish"
        : null;
  const showDevTools = isDevUi();

  useEffect(() => {
    setMissingCount(null);
    setCountError(null);
  }, [submitted.q, submitted.sort, submitted.excludeOwned]);

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
        <PageTitle>Download maps</PageTitle>
        <p className="rx-subtitle mt-2 max-w-2xl">
          Search online with the same query language as Practice — then download
          every missing set that matches. Downloads (single or batch) save{" "}
          <code className="text-ink">.osz</code> files into{" "}
          <code className="text-ink">{downloadDir}</code>. Use{" "}
          <span className="font-medium text-ink">Open in osu!</span> to import
          them into osu!lazer.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const next = {
            q,
            sort,
            excludeOwned,
            page: 0,
          };
          setPage(0);
          commit(next);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
            <span className="flex items-center gap-2">
              Query
              <QueryLanguageHelpButton />
            </span>
            <input
              className="rx-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="key=7 status=r"
              aria-label="Beatmap search query"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Sort
            <select
              className="rx-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort order"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rx-btn-primary shrink-0">
            Search
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
                  page: submitted.page,
                });
              }}
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
                  sort,
                  excludeOwned,
                  page,
                  noVideo: next,
                  pageCount,
                  downloadConcurrency,
                });
              }}
            />
            Download without video
          </label>
          <label className="inline-flex items-center gap-2">
            <span className="text-muted">Parallel downloads:</span>
            <input
              type="number"
              min={1}
              max={10}
              value={downloadConcurrency}
              onChange={(e) => {
                const next = Math.min(10, Math.max(1, Math.floor(Number(e.target.value))));
                setDownloadConcurrency(next);
                persist({ q, sort, excludeOwned, page, noVideo, pageCount, downloadConcurrency: next });
              }}
              className="w-12 rounded border border-subtle bg-surface px-1 py-0.5 text-center text-sm"
              aria-label="Number of maps to download in parallel (1–10)"
            />
            <span className="text-muted text-xs">(1–10)</span>
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
                "Count missing sets (uses hub search cache when primed, otherwise crawls the mirror)"
              }
            >
              {countMissing.isPending ? "Counting…" : "Count all missing"}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!canDownloadAllMissing || startQueryBatch.isPending}
              onClick={() => startQueryBatch.mutate()}
              title={
                missingActionsDisabledReason ??
                (!canDownloadAllMissing && submitted.excludeOwned
                  ? "No missing maps on this page — try another query or Count all missing"
                  : "Crawl the mirror for every missing set matching this query")
              }
            >
              {missingCount
                ? `Download all missing (${missingCount.matched.toLocaleString()}${missingCount.hitCap ? "+" : ""})`
                : "Download all missing"}
            </button>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Or pages from here
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
                    page,
                    noVideo,
                    pageCount: next,
                    downloadConcurrency,
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
              className="rx-btn"
              disabled={
                batchBusy || startPagesBatch.isPending || query.isLoading
              }
              onClick={() => startPagesBatch.mutate()}
            >
              Download {pageCount} page{pageCount === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!canOpenInOsu || openInOsu.isPending}
              onClick={() => {
                setOpenInOsuMessage(null);
                openInOsu.mutate();
              }}
              title="Open saved .osz files with osu!lazer (also writes import-into-osu.sh / .bat)"
            >
              {openInOsu.isPending
                ? "Opening…"
                : savedForImport > 0
                  ? `Open in osu! (${savedForImport})`
                  : "Open in osu!"}
            </button>
          </div>

          <p className="text-sm text-muted">
            Search shows one page (~50).{" "}
            <span className="font-medium text-ink">Count all missing</span> totals
            the result for{" "}
            <code className="text-ink">{submitted.q || "(defaults)"}</code>{" "}
            minus owned maps (hub search cache when primed, otherwise a mirror
            crawl) so you know the real total before{" "}
            <span className="font-medium text-ink">Download all missing</span>.
            Broad ranked/loved counts on hinai are usually instant; filters like{" "}
            <code className="text-ink">key=7</code> still crawl mirror pages
            (capped). Files go to the shared folder; then use{" "}
            <span className="font-medium text-ink">Open in osu!</span> or{" "}
            <code className="text-ink">import-into-osu.sh</code> /{" "}
            <code className="text-ink">import-into-osu.bat</code>.
          </p>

          {countError ? (
            <p className="text-sm text-danger">{countError}</p>
          ) : null}
          {missingCount ? (
            <p className="text-sm text-muted">
              Count:{" "}
              <span className="font-medium text-ink">
                {missingCount.matched.toLocaleString()}
              </span>{" "}
              missing
              {missingCount.ownedSkipped > 0
                ? ` · hid ${missingCount.ownedSkipped.toLocaleString()} owned/pending`
                : ""}
              {" · "}
              {missingCount.pagesScanned} page
              {missingCount.pagesScanned === 1 ? "" : "s"} scanned
              {missingCount.hitCap
                ? ` · hit safety cap (${missingCount.cappedAt.maxPages} pages / ${missingCount.cappedAt.maxSets.toLocaleString()} sets)`
                : ""}
            </p>
          ) : null}
          {countMissing.isPending ? (
            <p className="text-sm text-muted">
              Counting missing maps… broad ranked/loved queries are usually
              instant; post-filters like{" "}
              <code className="text-ink">key=7 status=r</code> may still crawl
              mirror pages.
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
                Batch: <span className="text-ink">{batch.status}</span>
                {" · "}
                {batch.mode}
                {" · "}
                {batch.downloaded}/{batch.queued || "?"} saved
                {batch.matched > 0
                  ? ` · ${batch.matched.toLocaleString()} matched`
                  : ""}
                {batch.pagesScanned > 0
                  ? ` · ${batch.pagesScanned} pages scanned`
                  : ""}
                {batch.hitCap ? " · hit safety cap" : ""}
                {batch.skippedExisting > 0
                  ? ` · ${batch.skippedExisting} already on disk`
                  : ""}
                {batch.skippedOwned > 0
                  ? ` · hid ${batch.skippedOwned} owned`
                  : ""}
                {batch.failed > 0 ? ` · ${batch.failed} failed` : ""}
                {savedForImport > 0
                  ? ` · ${savedForImport} ready to open`
                  : ""}
              </p>
              {batch.query ? (
                <p className="truncate text-faint">Query: {batch.query}</p>
              ) : null}
              {batch.error ? (
                <p className="text-danger">{batch.error}</p>
              ) : null}
              {batch.importScriptSh || batch.importScriptBat ? (
                <p className="truncate text-faint">
                  Import scripts:{" "}
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
            <h2 className="font-semibold text-ink">Dev · download UI</h2>
            <p className="text-sm text-muted">
              Client-only fake jobs — no mirror traffic, no{" "}
              <code className="text-ink">.osz</code> writes. Use these to try
              the session view, floating chip, ETA, and completion toast.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("fast")}
            >
              Fake fast (40)
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("realistic")}
            >
              Fake realistic (20)
            </button>
            <button
              type="button"
              className="rx-btn"
              disabled={batchBusy}
              onClick={() => runFake("fail")}
            >
              Fake fail mid-way
            </button>
            <button
              type="button"
              className="rx-btn"
              onClick={() =>
                pushToast({
                  title: "Download finished",
                  detail: "12 maps saved (dev toast)",
                  tone: "success",
                })
              }
            >
              Test completion toast
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
            : "Search failed"}
        </p>
      ) : query.data && "error" in query.data ? (
        <p className="text-danger">{String(query.data.error)}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
            <p>
              {items.length} result{items.length === 1 ? "" : "s"}
              {ownedSkipped > 0
                ? ` · hid ${ownedSkipped} you already own`
                : ""}
              {pendingSkipped + hiddenPendingLocal > 0
                ? ` · hid ${pendingSkipped + hiddenPendingLocal} recently downloaded`
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
                  <OnlineSetCard
                    set={set}
                    actions={
                      <button
                        type="button"
                        className="rx-btn-primary"
                        disabled={batchBusy || saveSet.isPending}
                        title="Save .osz into the shared beatmaps download folder"
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
                          ? "Saving…"
                          : "Download"}
                      </button>
                    }
                  />
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
