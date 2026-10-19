import { describe, expect, test } from "bun:test";
import { importGateDecision, waitForIdleImport } from "./pipeline";

const MIN = 60_000;
const NOW = 1_000_000_000_000;

describe("importGateDecision", () => {
  test("proceeds with no import row", () => {
    expect(importGateDecision(null, NOW)).toBe("proceed");
  });

  test("proceeds for success and failed imports", () => {
    expect(importGateDecision({ status: "success", startedAt: NOW }, NOW)).toBe(
      "proceed",
    );
    expect(importGateDecision({ status: "failed", startedAt: NOW }, NOW)).toBe(
      "proceed",
    );
  });

  test("waits while a fresh import is running, even past 5 minutes", () => {
    expect(importGateDecision({ status: "running", startedAt: NOW }, NOW)).toBe(
      "wait",
    );
    expect(
      importGateDecision(
        { status: "running", startedAt: NOW - 6 * MIN },
        NOW,
      ),
    ).toBe("wait");
    expect(
      importGateDecision(
        { status: "running", startedAt: new Date(NOW - 9 * MIN) },
        NOW,
      ),
    ).toBe("wait");
  });

  test("proceeds once a running import is stale (older than 10 minutes)", () => {
    expect(
      importGateDecision(
        { status: "running", startedAt: NOW - 10 * MIN - 1 },
        NOW,
      ),
    ).toBe("proceed");
  });
});

describe("waitForIdleImport", () => {
  function harness(rows: Array<{ status: string; startedAt: number } | null>) {
    let clock = NOW;
    let reads = 0;
    const sleeps: number[] = [];
    return {
      sleeps,
      reads: () => reads,
      read: () => {
        const row = rows[Math.min(reads, rows.length - 1)] ?? null;
        reads += 1;
        return row;
      },
      deps: {
        now: () => clock,
        pollMs: 1_000,
        sleep: async (ms: number) => {
          sleeps.push(ms);
          clock += ms;
        },
      },
    };
  }

  test("returns immediately when no import is running", async () => {
    const h = harness([{ status: "success", startedAt: NOW }]);
    const out = await waitForIdleImport(h.read, h.deps);
    expect(out.waited).toBe(false);
    expect(h.sleeps).toEqual([]);
  });

  test("keeps waiting past 5 minutes and resumes when the import succeeds", async () => {
    // 400 polls (~6.7 minutes at 1s) of "running", then success.
    const rows = [
      ...Array.from({ length: 400 }, () => ({
        status: "running",
        startedAt: NOW,
      })),
      { status: "success", startedAt: NOW },
    ];
    const h = harness(rows);
    const out = await waitForIdleImport(h.read, h.deps);
    expect(out.waited).toBe(true);
    expect(h.sleeps.length).toBe(400);
    expect(h.sleeps.length * 1_000).toBeGreaterThan(5 * MIN);
  });

  test("resumes when a running import fails", async () => {
    const h = harness([
      { status: "running", startedAt: NOW },
      { status: "running", startedAt: NOW },
      { status: "failed", startedAt: NOW },
    ]);
    const out = await waitForIdleImport(h.read, h.deps);
    expect(out.waited).toBe(true);
    expect(h.sleeps.length).toBe(2);
  });

  test("stops waiting when the running import goes stale", async () => {
    const h = harness([{ status: "running", startedAt: NOW }]);
    const out = await waitForIdleImport(h.read, h.deps);
    expect(out.waited).toBe(true);
    // Stale threshold is 10 minutes; polls advance the injected clock.
    expect(h.sleeps.length).toBeGreaterThanOrEqual(600);
    expect(h.sleeps.length).toBeLessThanOrEqual(602);
  });
});
