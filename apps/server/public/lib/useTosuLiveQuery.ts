import { useQuery } from "@tanstack/react-query";
import { fetchTosuLive, type TosuLive } from "./api";
import { useLiveSseOpen } from "./sse";

export function tosuLiveRefetchInterval(
  sseOpen: boolean,
  snap: TosuLive | undefined,
): number | false {
  if (sseOpen) return false;
  // Poll even when the snapshot says disabled: a wrongly cached disabled
  // snapshot (e.g. fetched before adapter init) must still self-heal.
  if (!snap?.enabled) return 10_000;
  if (snap.status === "connecting" || snap.status === "disconnected") {
    return 3_000;
  }
  return 5_000;
}

/** Shared tosu live query: poll only when SSE is down. */
export function useTosuLiveQuery<T = TosuLive>(opts?: {
  enabled?: boolean;
  select?: (data: TosuLive) => T;
}) {
  const sseOpen = useLiveSseOpen();
  return useQuery({
    queryKey: ["tosu", "live"],
    queryFn: fetchTosuLive,
    enabled: opts?.enabled ?? true,
    select: opts?.select,
    refetchInterval: (query) =>
      tosuLiveRefetchInterval(sseOpen, query.state.data),
  });
}
