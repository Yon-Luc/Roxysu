import { focusManager, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { ModBadges } from "../../components/ModBadges";
import { fetchOverlay } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";

const DEFAULT_LIMIT = 8;
const OVERLAY_CLASS = "overlay-mode";
/** OBS Browser Sources often background the page; poll instead of relying on SSE alone. */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 8_000;

type OverlayBg = "solid" | "clear";

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), 25);
}

export function OverlayPage({
  limit: limitProp,
  bg: bgProp,
}: {
  limit?: number;
  bg?: OverlayBg;
}) {
  const limit = clampLimit(limitProp ?? DEFAULT_LIMIT);
  const bg: OverlayBg = bgProp === "clear" ? "clear" : "solid";

  useEffect(() => {
    document.documentElement.classList.add(OVERLAY_CLASS);
    // Keep React Query treating this page as focused (OBS CEF is often "hidden").
    focusManager.setFocused(true);
    return () => {
      document.documentElement.classList.remove(OVERLAY_CLASS);
      focusManager.setFocused(undefined);
    };
  }, []);

  const overlayQuery = useQuery({
    queryKey: ["overlay", limit],
    queryFn: () => fetchOverlay(limit),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.mode === "live" ? LIVE_POLL_MS : IDLE_POLL_MS,
    refetchIntervalInBackground: true,
    networkMode: "always",
  });

  const payload = overlayQuery.data;
  const mode = payload?.mode ?? "empty";
  const liveSession = payload?.session ?? null;
  const scores = payload?.scores ?? [];

  const knownIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const scoreIdsKey = scores.map((s) => s.id).join(",");

  useEffect(() => {
    const incoming = scoreIdsKey.length > 0 ? scoreIdsKey.split(",") : [];
    if (!seeded.current) {
      knownIds.current = new Set(incoming);
      seeded.current = true;
      return;
    }

    const nextFresh = new Set<string>();
    for (const id of incoming) {
      if (!knownIds.current.has(id)) nextFresh.add(id);
    }
    if (nextFresh.size > 0) {
      knownIds.current = new Set(incoming);
      setFreshIds(nextFresh);
      const timer = window.setTimeout(() => setFreshIds(new Set()), 4_000);
      return () => window.clearTimeout(timer);
    }
  }, [scoreIdsKey]);

  useEffect(() => {
    seeded.current = false;
    knownIds.current = new Set();
    setFreshIds(new Set());
  }, [mode]);

  if (overlayQuery.isLoading && !overlayQuery.data) {
    return null;
  }

  if (mode === "empty") {
    return null;
  }

  return (
    <div className="overlay-root pointer-events-none select-none p-3">
      <div
        className={
          bg === "solid"
            ? "w-full max-w-md rounded-xl border border-white/10 bg-[#0d0d0d]/92 px-3 py-3 shadow-2xl shadow-black/60 backdrop-blur-md"
            : "w-full max-w-md"
        }
      >
        <header className="mb-2.5 flex items-center gap-2 px-0.5">
          {mode === "live" ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-accent overlay-text">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              Live session
              {liveSession ? (
                <span className="font-semibold normal-case tracking-normal text-white/75">
                  · {liveSession.scoreCount} plays
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/80 overlay-text">
              Recent scores
            </span>
          )}
        </header>

        <ul className="flex flex-col gap-1">
          {scores.map((score) => {
            const isFresh = freshIds.has(score.id);
            return (
              <li
                key={score.id}
                className={`overlay-row flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-700 ${
                  bg === "solid"
                    ? isFresh
                      ? "bg-accent/15"
                      : "bg-white/[0.06]"
                    : isFresh
                      ? "bg-black/70"
                      : "bg-black/55"
                }`}
              >
                <BeatmapCover
                  backgroundFileHash={score.backgroundFileHash}
                  setOnlineId={score.setOnlineId}
                  size="list"
                  className="h-9 w-9 shrink-0 rounded shadow-md shadow-black/50"
                  alt=""
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-white overlay-text">
                      {score.title ?? "Untitled"}
                    </span>
                    {score.isPb ? (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-300 overlay-text">
                        PB
                      </span>
                    ) : null}
                    {isFresh ? (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent overlay-text">
                        New
                      </span>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-1 truncate text-xs text-white/70 overlay-text">
                    <span className="truncate">
                      {score.difficultyName ?? score.artist ?? "—"}
                    </span>
                    <ModBadges mods={score.mods} variant="overlay" />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-white overlay-text">
                    {formatAccuracy(score.accuracy)}
                  </div>
                  <div className="text-[11px] tabular-nums text-white/65 overlay-text">
                    {formatPp(score.pp)}
                    {mode === "recent"
                      ? ` · ${formatRelativeTime(score.playedAt)}`
                      : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
