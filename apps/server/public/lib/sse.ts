import type { QueryClient } from "@tanstack/react-query";

/**
 * Scoped SSE → cache invalidation map.
 *
 * Each event only invalidates the query keys that depend on it.
 * Previously a single `onLive` handler blasted all 7 keys on every event,
 * causing 5–6 redundant refetches per score import / session event.
 */

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
    void queryClient.invalidateQueries({
      queryKey: ["practice"],
      refetchType: "none",
    });
    void queryClient.invalidateQueries({
      queryKey: ["beatmap"],
      refetchType: "none",
    });
  };

  // dashboard.updated: aggregate stats changed (sync pipeline ran analytics).
  const onDashboardUpdated = () => {
    inv(["dashboard"]);
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
  };

  // collection.updated: only collections page cares.
  const onCollectionUpdated = (event?: Event) => {
    inv(["collections"]);
    if (!event) return;
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
    inv(["sessions"]);
    void queryClient.invalidateQueries({
      queryKey: ["collections"],
      refetchType: "none",
    });
    inv(["settings"]);
    inv(["beatmap-preview"]);
    inv(["score-replay"]);
  };

  const onTosu = () => {
    inv(["tosu", "live"]);
  };

  const HANDLERS: Record<string, () => void> = {
    "score.imported": onScoreImported,
    "dashboard.updated": onDashboardUpdated,
    "mastery.updated": onMasteryUpdated,
    "session.started": onSessionEvent,
    "session.finished": onSessionEvent,
    "sync.finished": onSyncFinished,
    "tosu.updated": onTosu,
  };

  for (const [name, handler] of Object.entries(HANDLERS)) {
    source.addEventListener(name, handler);
  }
  source.addEventListener("collection.updated", onCollectionUpdated);

  source.onerror = () => {
    // Browser auto-reconnects EventSource
  };

  return () => {
    for (const [name, handler] of Object.entries(HANDLERS)) {
      source.removeEventListener(name, handler);
    }
    source.removeEventListener("collection.updated", onCollectionUpdated);
    source.close();
  };
}
