import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { TosuLive } from "./api";

/**
 * Scoped SSE → cache invalidation map.
 *
 * Each event only invalidates the query keys that depend on it.
 * Previously a single `onLive` handler blasted all 7 keys on every event,
 * causing 5–6 redundant refetches per score import / session event.
 */

let liveSseOpen = false;
const sseStatusListeners = new Set<() => void>();

export function isLiveSseOpen(): boolean {
  return liveSseOpen;
}

export function subscribeLiveSseStatus(listener: () => void): () => void {
  sseStatusListeners.add(listener);
  return () => sseStatusListeners.delete(listener);
}

function setLiveSseOpen(next: boolean): void {
  if (liveSseOpen === next) return;
  liveSseOpen = next;
  for (const listener of sseStatusListeners) listener();
}

export function useLiveSseOpen(): boolean {
  const [open, setOpen] = useState(isLiveSseOpen);
  useEffect(
    () => subscribeLiveSseStatus(() => setOpen(isLiveSseOpen())),
    [],
  );
  return open;
}

/** Subscribe to server SSE and invalidate React Query caches on live events. */
export function connectLiveUpdates(queryClient: QueryClient): () => void {
  const source = new EventSource("/api/events");

  const inv = (key: unknown[]) =>
    void queryClient.invalidateQueries({ queryKey: key });

  // score.imported: new play landed — refresh session feed + dashboard.
  // Practice list is marked stale but not refetched immediately (refetchType: "none")
  // so it picks up the update on the next user interaction rather than mid-browse.
  const onScoreImported = () => {
    inv(["dashboard"]);
    inv(["sessions"]);
    inv(["overlay"]);
    void queryClient.invalidateQueries({
      queryKey: ["practice"],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({
      queryKey: ["beatmap"],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({
      queryKey: ["beatmap-stats"],
      refetchType: "none",
    });
  };

  // dashboard.updated: aggregate stats changed (sync pipeline ran analytics).
  const onDashboardUpdated = () => {
    inv(["dashboard"]);
    void queryClient.invalidateQueries({
      queryKey: ["stats"],
      refetchType: "active",
    });
  };

  // mastery.updated: recompute finished — practice cards + beatmap detail change.
  const onMasteryUpdated = () => {
    inv(["practice"]);
    inv(["beatmap"]);
    inv(["dashboard"]);
  };

  // session.started / session.finished: session list + dashboard session stat.
  const onSessionEvent = () => {
    inv(["sessions"]);
    inv(["dashboard"]);
    inv(["overlay"]);
  };

  // collection.updated: only collections page cares.
  const onCollectionUpdated = (event: Event) => {
    inv(["collections"]);
    try {
      const detail = JSON.parse((event as MessageEvent).data) as {
        collectionId?: number;
      };
      if (detail.collectionId != null) {
        void queryClient.invalidateQueries({
          queryKey: ["collections", detail.collectionId, "results"],
        });
      }
    } catch {
      // ignore malformed payload
    }
  };

  /** sync.finished: full resync done — refresh everything + preview/replay hashes. */
  const onSyncFinished = () => {
    inv(["dashboard"]);
    inv(["system", "status"]);
    void queryClient.invalidateQueries({
      queryKey: ["practice"],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({
      queryKey: ["beatmap"],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({
      queryKey: ["beatmap-stats"],
      refetchType: "none",
    });
    inv(["sessions"]);
    void queryClient.invalidateQueries({
      queryKey: ["collections"],
      refetchType: "none",
    });
    inv(["settings"]);
    inv(["beatmap-preview"]);
    inv(["score-replay"]);
    inv(["overlay"]);
    inv(["owned-set-ids"]);
    void queryClient.invalidateQueries({
      queryKey: ["stats"],
      refetchType: "active",
    });
  };

  const onTosu = (event: Event) => {
    try {
      const detail = JSON.parse((event as MessageEvent).data) as {
        reason?: "play" | "full";
        play?: TosuLive["play"];
        beatmapState?: string | null;
        beatmapTimeMs?: number | null;
      };
      if (detail.reason === "play") {
        queryClient.setQueryData<TosuLive>(["tosu", "live"], (prev) => {
          if (!prev) return prev;
          let beatmap = prev.beatmap;
          if (beatmap && detail.beatmapState !== undefined) {
            beatmap = { ...beatmap, state: detail.beatmapState };
          }
          if (beatmap && detail.beatmapTimeMs !== undefined) {
            beatmap = { ...beatmap, timeLiveMs: detail.beatmapTimeMs };
          }
          return {
            ...prev,
            play: detail.play ?? prev.play,
            beatmap,
          };
        });
        return;
      }
    } catch {
      // fall through to a full refetch
    }
    inv(["tosu", "live"]);
  };

  const HANDLERS: Record<string, (event: Event) => void> = {
    "score.imported": onScoreImported,
    "dashboard.updated": onDashboardUpdated,
    "mastery.updated": onMasteryUpdated,
    "session.started": onSessionEvent,
    "session.finished": onSessionEvent,
    "sync.finished": onSyncFinished,
    "tosu.updated": onTosu,
  };

  source.onopen = () => setLiveSseOpen(true);
  source.onerror = () => {
    setLiveSseOpen(false);
    // Browser auto-reconnects EventSource
  };

  for (const [name, handler] of Object.entries(HANDLERS)) {
    source.addEventListener(name, handler);
  }
  source.addEventListener("collection.updated", onCollectionUpdated);

  return () => {
    setLiveSseOpen(false);
    for (const [name, handler] of Object.entries(HANDLERS)) {
      source.removeEventListener(name, handler);
    }
    source.removeEventListener("collection.updated", onCollectionUpdated);
    source.close();
  };
}
