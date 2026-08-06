import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "./BeatmapCover";
import { fetchPracticePatterns } from "../lib/api";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../lib/ratingDisplay";

type PatternAxis = "all" | "rc" | "ln";
type PatternKeymode = 4 | 7;

const KEYMODE_TABS: { value: PatternKeymode; label: string }[] = [
  { value: 4, label: "4K" },
  { value: 7, label: "7K" },
];

const AXIS_TABS: { value: PatternAxis; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Every analyzed map in this keymode" },
  {
    value: "rc",
    label: "RC",
    hint: "Mainly rice (<20% LN) — jack, stream, chord patterns",
  },
  {
    value: "ln",
    label: "LN",
    hint: "Mainly long notes (≥20% LN) — rice patterns on LN-heavy charts",
  },
];

type PatternBrowserModalProps = {
  onClose: () => void;
  onApplyQuery: (query: string) => void;
};

export function PatternBrowserButton({
  className,
  onApplyQuery,
}: {
  className?: string;
  onApplyQuery: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-sm font-medium text-accent underline decoration-accent/40 underline-offset-2 transition hover:text-ink"
        }
      >
        Patterns
      </button>
      {open ? (
        <PatternBrowserModal
          onClose={() => setOpen(false)}
          onApplyQuery={(query) => {
            onApplyQuery(query);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function PatternBrowserModal({
  onClose,
  onApplyQuery,
}: PatternBrowserModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const ratingMode = useRatingDisplayMode();
  const [keymode, setKeymode] = useState<PatternKeymode>(7);
  const [axis, setAxis] = useState<PatternAxis>("rc");

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["practice-patterns", keymode, axis],
    queryFn: () =>
      fetchPracticePatterns({
        samples: 5,
        keymode,
        axis: axis === "all" ? "all" : axis,
      }),
  });

  const activeTab = AXIS_TABS.find((t) => t.value === axis) ?? AXIS_TABS[0]!;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[min(90vh,44rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-white/5 bg-elevated/95 backdrop-blur">
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <h2 id={titleId} className="font-display text-xl font-bold text-ink">
                Mania patterns
              </h2>
              <p className="mt-1 text-sm text-muted">
                Browse by dominant Interlude pattern for 4K or 7K. Click a group
                to search practice.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
              aria-label="Close"
            >
              Esc
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
            <div className="flex gap-1">
              {KEYMODE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setKeymode(tab.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    keymode === tab.value
                      ? "bg-accent-glow text-accent"
                      : "text-muted hover:bg-highlight hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="h-5 w-px bg-white/10" aria-hidden />
            <div className="flex gap-1">
              {AXIS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setAxis(tab.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    axis === tab.value
                      ? "bg-accent-glow text-accent"
                      : "text-muted hover:bg-highlight hover:text-ink"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6 px-5 py-5">
          <p className="text-xs text-muted">
            {keymode}K · {activeTab.hint}
            {keymode === 4
              ? " · Jumpstream / stream families"
              : " · Delay / chordstream / bracket families"}
          </p>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted">
              Analyzing {keymode}K charts…
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-rose-300">
              {error.message}
            </p>
          ) : !data || data.patterns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No analyzed patterns in this group yet.
              {axis !== "all"
                ? " Sunny LN classification may still be backfilling — try All or check back shortly."
                : " Pattern analysis runs when you open this view or search with pattern filters."}
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {data.analyzed.toLocaleString()} analyzed
                {axis === "all"
                  ? ` of ${(data.totalMania ?? data.total7k).toLocaleString()} ${keymode}K maps`
                  : ` in ${(data.axisTotalMania ?? data.axisTotal7k).toLocaleString()} ${axis.toUpperCase()} maps (${(data.totalMania ?? data.total7k).toLocaleString()} ${keymode}K total)`}
                {data.remaining > 0 && axis === "all"
                  ? ` · ${data.remaining.toLocaleString()} still pending`
                  : ""}
                {isFetching ? " · refreshing…" : ""}
              </p>

              {data.patterns.map((group) => (
                <section
                  key={group.pattern}
                  className="overflow-hidden rounded-xl bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => onApplyQuery(group.query)}
                    className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-highlight/40"
                  >
                    <div>
                      <h3 className="font-semibold text-ink">{group.label}</h3>
                      <p className="mt-0.5 font-mono text-xs text-muted">
                        {group.query}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular-nums text-accent">
                        {group.count.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-muted">maps</div>
                    </div>
                  </button>

                  {group.samples.length > 0 ? (
                    <ul className="divide-y divide-white/5">
                      {group.samples.map((item) => (
                        <li key={item.id}>
                          <Link
                            to="/practice/$beatmapId"
                            params={{ beatmapId: item.id }}
                            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-highlight/30"
                            onClick={onClose}
                          >
                            <BeatmapCover
                              backgroundFileHash={item.backgroundFileHash}
                              setOnlineId={item.setOnlineId}
                              size="list"
                              className="h-11 w-16 shrink-0 rounded-md"
                              alt=""
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-ink">
                                {item.title ?? "Untitled"}
                              </div>
                              <div className="truncate text-xs text-muted">
                                {item.artist ?? "Unknown artist"} · [
                                {item.difficultyName ?? "—"}] ·{" "}
                                {formatPrimaryRating({
                                  mode: ratingMode,
                                  starRating: item.starRating,
                                  sunnyEstDiff: item.sunnyEstDiff,
                                  sunnyStar: item.sunnyStar,
                                  danielEstDiff: item.danielEstDiff,
                                  danielStar: item.danielStar,
                                  keyCount: item.keyCount,
                                })}
                              </div>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
