import { focusManager, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOverlay, fetchOverlaySkins } from "../../lib/api";
import { applyOverlaySkinSnapshot } from "../../lib/overlaySkins";
import { useTosuLiveQuery } from "../../lib/useTosuLiveQuery";
import { defaultOverlayProfile } from "@server/overlay/profiles";
import {
  OverlayStage,
} from "./OverlayStage";
import type { OverlayElementContext } from "./OverlayElements";
import { ScoreListElement } from "./OverlayElements";

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
  profile: profileRef,
}: {
  limit?: number;
  bg?: OverlayBg;
  profile?: string;
}) {
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
    queryKey: ["overlay", limitProp ?? null, bgProp ?? null, profileRef ?? null],
    queryFn: () => fetchOverlay(limitProp, profileRef),
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
  const scoreIdsKey = useMemo(
    () => scores.map((s) => s.id).join(","),
    [scores],
  );

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

  // No ?profile= → implicit single score-list layout; a missing requested
  // profile yields null → page renders nothing.
  const profile =
    payload?.profile ?? (profileRef != null ? null : defaultOverlayProfile());
  const snapshotQuery = useTosuLiveQuery({ enabled: profileRef != null });

  // Consumer contexts (OBS browser source / Wayland host) start with empty
  // skin stores; apply the server-side snapshot so they match the editor.
  useEffect(() => {
    if (!profileRef) return;
    let cancelled = false;
    void fetchOverlaySkins()
      .then(({ snapshot }) => {
        if (!cancelled && snapshot) return applyOverlaySkinSnapshot(snapshot);
      })
      .catch(() => {
        /* skins are best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [profileRef]);

  const ctx: OverlayElementContext = useMemo(
    () => ({
      bg: profile?.bg ?? (bgProp === "clear" ? "clear" : "solid"),
      mode,
      scores,
      freshIds,
      session: liveSession,
      snapshot: snapshotQuery.data ?? null,
    }),
    [
      profile?.bg,
      bgProp,
      mode,
      scores,
      freshIds,
      liveSession,
      snapshotQuery.data,
    ],
  );

  if (overlayQuery.isLoading && !overlayQuery.data) {
    return null;
  }

  if (!profile) {
    // A requested profile that does not exist server-side renders nothing.
    return null;
  }

  if (!profileRef) {
    // Legacy rendering: natural-width single-column list (pre-profile behavior).
    if (mode === "empty") return null;
    const legacyCtx: OverlayElementContext = {
      ...ctx,
      scores: scores.slice(0, clampLimit(limitProp)),
    };
    return (
      <div className="overlay-root pointer-events-none select-none p-3">
        <div className="w-full max-w-md">
          <ScoreListElement ctx={legacyCtx} />
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-root pointer-events-none select-none">
      <OverlayStage profile={profile} ctx={ctx} />
    </div>
  );
}
