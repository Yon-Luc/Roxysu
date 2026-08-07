import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadPendingDownloadIds,
  prunePendingDownloadsAgainstOwned,
  recordPendingDownloads,
} from "./pendingDownloads";

describe("pendingDownloads", () => {
  test("records and loads set ids", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-pending-"));
    try {
      expect(loadPendingDownloadIds(dir).size).toBe(0);
      recordPendingDownloads([10, 20, 10], dir);
      expect([...loadPendingDownloadIds(dir)].sort()).toEqual([10, 20]);
      recordPendingDownloads([30], dir);
      expect([...loadPendingDownloadIds(dir)].sort()).toEqual([10, 20, 30]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prunes ids that are now owned", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-pending-"));
    try {
      recordPendingDownloads([1, 2, 3], dir);
      const { remaining, pruned } = prunePendingDownloadsAgainstOwned(
        new Set([2, 99]),
        dir,
      );
      expect(pruned).toBe(1);
      expect([...remaining].sort()).toEqual([1, 3]);
      expect([...loadPendingDownloadIds(dir)].sort()).toEqual([1, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
