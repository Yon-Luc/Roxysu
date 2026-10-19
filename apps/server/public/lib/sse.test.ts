import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { applyTosuUpdated } from "./sse";
import type { TosuLive } from "./api";

const KEY = ["tosu", "live"];

function snapshot(): TosuLive {
  return {
    connected: true,
    status: "connected",
    host: "127.0.0.1:24050",
    enabled: true,
    warnings: [],
    beatmap: { state: "play", timeLiveMs: 1 },
    play: { active: false },
    analysis: {},
  } as unknown as TosuLive;
}

const playTick = JSON.stringify({
  reason: "play",
  play: { active: true, combo: 42 },
  beatmapState: "play",
  beatmapTimeMs: 5000,
});

describe("applyTosuUpdated", () => {
  test("play tick with no cached snapshot refetches instead of dropping", () => {
    const qc = new QueryClient();
    const invalidated: unknown[] = [];
    qc.invalidateQueries = ((filters: { queryKey?: unknown }) => {
      invalidated.push(filters.queryKey);
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;
    applyTosuUpdated(qc, playTick);
    expect(invalidated).toEqual([KEY]);
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  test("play tick while the first fetch is in flight does not restart it", () => {
    const qc = new QueryClient();
    void qc.prefetchQuery({
      queryKey: KEY,
      queryFn: () => new Promise(() => {}),
    });
    let calls = 0;
    qc.invalidateQueries = (() => {
      calls++;
      return Promise.resolve();
    }) as typeof qc.invalidateQueries;
    applyTosuUpdated(qc, playTick);
    expect(calls).toBe(0);
  });

  test("play tick with an empty client does not throw or create data", () => {
    const qc = new QueryClient();
    applyTosuUpdated(qc, playTick);
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  test("play tick patches an existing snapshot in place", () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, snapshot());
    applyTosuUpdated(qc, playTick);
    const next = qc.getQueryData<TosuLive>(KEY);
    expect(next?.play).toEqual({ active: true, combo: 42 } as never);
    expect(next?.beatmap?.timeLiveMs).toBe(5000);
    expect(qc.getQueryState(KEY)?.isInvalidated).toBe(false);
  });

  test("full reason and malformed payloads invalidate", () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, snapshot());
    applyTosuUpdated(qc, JSON.stringify({ reason: "full" }));
    expect(qc.getQueryState(KEY)?.isInvalidated).toBe(true);

    const qc2 = new QueryClient();
    qc2.setQueryData(KEY, snapshot());
    applyTosuUpdated(qc2, "not json");
    expect(qc2.getQueryState(KEY)?.isInvalidated).toBe(true);
  });
});
