import { describe, expect, test } from "bun:test";
import type { Db } from "@roxysu/db/types";
import { shutdownBackgroundWork, type ShutdownJobsDeps } from "./shutdownJobs";

const db = {} as Db;

function makeDeps(overrides: Partial<ShutdownJobsDeps> = {}) {
  const calls: string[] = [];
  let t = 0;
  const deps: ShutdownJobsDeps = {
    shutdownAnalytics: async () => {
      calls.push("analytics");
      return true;
    },
    stops: [() => calls.push("stop-a"), () => calls.push("stop-b")],
    asyncJobStatuses: [],
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
    ...overrides,
  };
  return { deps, calls };
}

describe("shutdownBackgroundWork", () => {
  test("requests every stop and awaits analytics", async () => {
    const { deps, calls } = makeDeps();
    expect(await shutdownBackgroundWork(db, { deps })).toBe(true);
    expect(calls).toEqual(["stop-a", "stop-b", "analytics"]);
  });

  test("waits for an async job to leave running/stopping", async () => {
    let polls = 0;
    const { deps } = makeDeps({
      asyncJobStatuses: [() => (++polls < 4 ? "stopping" : "idle")],
    });
    expect(await shutdownBackgroundWork(db, { deps })).toBe(true);
    expect(polls).toBe(4);
  });

  test("gives up at the deadline and still resolves", async () => {
    const { deps } = makeDeps({ asyncJobStatuses: [() => "running"] });
    expect(await shutdownBackgroundWork(db, { deps, timeoutMs: 200 })).toBe(false);
  });

  test("a throwing stop does not prevent the others", async () => {
    const { deps, calls } = makeDeps({
      stops: [
        () => {
          throw new Error("boom");
        },
        () => calls.push("stop-b"),
      ],
    });
    expect(await shutdownBackgroundWork(db, { deps })).toBe(true);
    expect(calls).toContain("stop-b");
  });
});
