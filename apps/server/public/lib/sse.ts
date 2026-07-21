import type { QueryClient } from "@tanstack/react-query";

const LIVE_EVENTS = new Set([
  "sync.finished",
  "score.imported",
  "dashboard.updated",
  "mastery.updated",
  "session.started",
  "session.finished",
  "collection.updated",
  "tosu.updated",
]);

/** Subscribe to server SSE and invalidate React Query caches on live events. */
export function connectLiveUpdates(queryClient: QueryClient): () => void {
  const source = new EventSource("/api/events");

  const onLive = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["system"] });
    void queryClient.invalidateQueries({ queryKey: ["practice"] });
    void queryClient.invalidateQueries({ queryKey: ["beatmap"] });
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  const onTosu = () => {
    void queryClient.invalidateQueries({ queryKey: ["tosu", "live"] });
  };

  for (const name of LIVE_EVENTS) {
    if (name === "tosu.updated") {
      source.addEventListener(name, onTosu);
    } else {
      source.addEventListener(name, onLive);
    }
  }

  source.onerror = () => {
    // Browser auto-reconnects EventSource
  };

  return () => {
    for (const name of LIVE_EVENTS) {
      if (name === "tosu.updated") {
        source.removeEventListener(name, onTosu);
      } else {
        source.removeEventListener(name, onLive);
      }
    }
    source.close();
  };
}
