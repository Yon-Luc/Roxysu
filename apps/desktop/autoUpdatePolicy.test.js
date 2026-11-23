import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  UPDATE_RECHECK_MS,
  downloadProgressBucket,
  shouldLogDownloadProgress,
  installDownloadedUpdate,
} = require("./autoUpdatePolicy.js");

describe("autoUpdatePolicy", () => {
  test("download buckets are 10% steps clamped to 0..100", () => {
    expect(downloadProgressBucket(0)).toBe(0);
    expect(downloadProgressBucket(9.9)).toBe(0);
    expect(downloadProgressBucket(10)).toBe(10);
    expect(downloadProgressBucket(19)).toBe(10);
    expect(downloadProgressBucket(100)).toBe(100);
    expect(downloadProgressBucket(140)).toBe(100);
    expect(downloadProgressBucket(NaN)).toBe(null);
    expect(downloadProgressBucket(undefined)).toBe(null);
  });

  test("progress logs once per new bucket and ignores a null percent", () => {
    let last = null;

    let decision = shouldLogDownloadProgress(last, 3);
    expect(decision).toEqual({ log: true, bucket: 0 });
    last = decision.bucket;

    decision = shouldLogDownloadProgress(last, 7);
    expect(decision).toEqual({ log: false, bucket: 0 });
    last = decision.bucket;

    decision = shouldLogDownloadProgress(last, 10);
    expect(decision).toEqual({ log: true, bucket: 10 });
    last = decision.bucket;

    decision = shouldLogDownloadProgress(last, 10.5);
    expect(decision).toEqual({ log: false, bucket: 10 });
    last = decision.bucket;

    decision = shouldLogDownloadProgress(last, null);
    expect(decision).toEqual({ log: false, bucket: 10 });
    expect(decision.bucket).toBe(last);
  });

  test("install awaits beforeInstall, then quitAndInstall(true, true)", async () => {
    const order = [];
    const calls = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const pending = installDownloadedUpdate({
      autoUpdater: {
        quitAndInstall(isSilent, isForceRunAfter) {
          order.push("quitAndInstall");
          calls.push([isSilent, isForceRunAfter]);
        },
      },
      beforeInstall: async () => {
        order.push("beforeInstall");
        await gate;
        order.push("beforeInstall-done");
      },
      log: (message) => order.push(`log:${message}`),
    });

    expect(order).toEqual(["beforeInstall"]);
    expect(calls).toEqual([]);

    release();
    await pending;

    expect(order.indexOf("beforeInstall")).toBeLessThan(order.indexOf("beforeInstall-done"));
    expect(order.indexOf("beforeInstall-done")).toBeLessThan(order.indexOf("quitAndInstall"));
    expect(calls).toEqual([[true, true]]);
  });

  test("a throwing beforeInstall is logged and does not quitAndInstall", async () => {
    const err = new Error("shutdown failed");
    const calls = [];
    const logs = [];

    await installDownloadedUpdate({
      autoUpdater: {
        quitAndInstall(...args) {
          calls.push(args);
        },
      },
      beforeInstall: async () => {
        throw err;
      },
      log: (message) => logs.push(message),
    });

    expect(calls).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(String(logs[0])).toContain(err.message);
    expect(String(logs[0])).toContain(String(err));
  });

  test("missing beforeInstall still quitAndInstalls", async () => {
    const calls = [];
    await installDownloadedUpdate({
      autoUpdater: {
        quitAndInstall(...args) {
          calls.push(args);
        },
      },
      log: () => {},
    });
    expect(calls).toEqual([[true, true]]);
  });

  test("recheck interval is 6 hours", () => {
    expect(UPDATE_RECHECK_MS).toBe(21_600_000);
  });
});
