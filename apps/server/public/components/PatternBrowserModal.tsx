import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "./BeatmapCover";
import { fetchPracticePatterns } from "../lib/api";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../lib/ratingDisplay";

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
          "text-sm font-medium text-muted underline decoration-white/20 underline-offset-2 transition hover:text-accent"
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["practice-patterns"],
    queryFn: () => fetchPracticePatterns({ samples: 5 }),
  });

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
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-white/5 bg-elevated/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 id={titleId} className="font-display text-xl font-bold text-ink">
              7K patterns
            </h2>
            <p className="mt-1 text-sm text-muted">
              Browse dominant pattern groups in your library. Click a pattern to
              search practice with that filter.
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

        <div className="space-y-6 px-5 py-5">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted">
              Analyzing 7K charts…
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-rose-300">
              {error.message}
            </p>
          ) : !data || data.patterns.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No analyzed 7K patterns yet. Pattern analysis runs when you open
              this view or search with{" "}
              <code className="text-subtle">pattern:</code> filters.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {data.analyzed.toLocaleString()} of{" "}
                {data.total7k.toLocaleString()} 7K maps analyzed
                {data.remaining > 0
                  ? ` · ${data.remaining.toLocaleString()} still pending`
                  : ""}
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