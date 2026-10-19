import { describe, expect, test } from "bun:test";
import { loadRecentBmsSessions, type BmsSessionScore } from "./bmsInterpret";

const MINUTE = 60_000;

function score(id: number, playedAt: number): BmsSessionScore {
  return { id: `s${String(id).padStart(5, "0")}`, playedAt, exScore: 1, normalizedScore: 1 };
}

/** Newest-first reader over a fixed history, counting page reads. */
function reader(history: BmsSessionScore[]) {
  const desc = [...history].sort((a, b) => b.playedAt - a.playedAt);
  const calls: Array<[number, number]> = [];
  return {
    calls,
    read: async (offset: number, limit: number) => {
      calls.push([offset, limit]);
      return desc.slice(offset, offset + limit);
    },
  };
}

describe("loadRecentBmsSessions", () => {
  test("stops after one page when the peeked row is past the session gap", async () => {
    const history = [
      ...Array.from({ length: 10 }, (_, i) => score(i, i * MINUTE)),
      ...Array.from({ length: 400 }, (_, i) => score(100 + i, 5 * 60 * MINUTE + i * MINUTE)),
    ];
    const r = reader(history);
    const sessions = await loadRecentBmsSessions(r.read, { pageSize: 400 });
    expect(r.calls).toHaveLength(1);
    expect(sessions.map((s) => s.scoreCount)).toEqual([400]);
  });

  test("keeps paging while the oldest session continues, then stops at the gap", async () => {
    const history = Array.from({ length: 1000 }, (_, i) => score(i, i * MINUTE));
    const r = reader(history);
    const sessions = await loadRecentBmsSessions(r.read, { pageSize: 400 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.scoreCount).toBe(1000);
    expect(r.calls.map(([offset]) => offset)).toEqual([0, 400, 800]);
  });

  test("the hard cap is the only thing that cuts a session", async () => {
    const history = Array.from({ length: 1000 }, (_, i) => score(i, i * MINUTE));
    const r = reader(history);
    const sessions = await loadRecentBmsSessions(r.read, { pageSize: 400, maxScores: 600 });
    expect(sessions[0]?.scoreCount).toBe(600);
  });

  test("stops once more than the shown number of sessions is loaded", async () => {
    const history = Array.from({ length: 5000 }, (_, i) => score(i, i * 2 * 60 * MINUTE));
    const r = reader(history);
    const sessions = await loadRecentBmsSessions(r.read, { pageSize: 400, sessions: 20 });
    expect(r.calls).toHaveLength(1);
    expect(sessions).toHaveLength(20);
  });

  test("empty history returns no sessions", async () => {
    const r = reader([]);
    expect(await loadRecentBmsSessions(r.read)).toEqual([]);
  });
});
