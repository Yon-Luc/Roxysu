import { afterEach, describe, expect, test } from "bun:test";
import {
  clearStuckMirrorBatchLocks,
  getMirrorBatchJobState,
  resetMirrorBatchJobForTests,
  simulateStuckMirrorBatchForTests,
  stopMirrorBatchJob,
} from "./batchJob";

describe("clearStuckMirrorBatchLocks", () => {
  afterEach(() => {
    resetMirrorBatchJobForTests();
  });

  test("returns false when idle (startup no-op)", () => {
    resetMirrorBatchJobForTests();
    expect(clearStuckMirrorBatchLocks()).toBe(false);
    expect(getMirrorBatchJobState().status).toBe("idle");
  });

  test("clears a hung stopping batch", () => {
    resetMirrorBatchJobForTests();
    simulateStuckMirrorBatchForTests("stopping");
    expect(getMirrorBatchJobState().status).toBe("stopping");

    expect(clearStuckMirrorBatchLocks()).toBe(true);
    const state = getMirrorBatchJobState();
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/lock was cleared/i);
    // UI treats only running/stopping as busy — error unlocks the buttons.
    expect(state.status === "running" || state.status === "stopping").toBe(
      false,
    );
  });

  test("second stop force-clears when already stopping", () => {
    resetMirrorBatchJobForTests();
    simulateStuckMirrorBatchForTests("stopping");

    const first = stopMirrorBatchJob();
    expect(first.status).toBe("error");
    expect(first.error).toMatch(/lock was cleared/i);
  });

  test("first stop only requests graceful stop while running", () => {
    resetMirrorBatchJobForTests();
    simulateStuckMirrorBatchForTests("running");

    const state = stopMirrorBatchJob();
    expect(state.status).toBe("stopping");
  });
});
