import { useSyncExternalStore } from "react";
import type { MirrorBatchJob } from "../../lib/api";

type Listener = () => void;

type FakeController = {
  stopRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export type FakeDownloadPreset = "fast" | "realistic" | "fail";

type FakeStartOptions = {
  preset: FakeDownloadPreset;
  count?: number;
};

const FAKE_TITLES = [
  "Nightfall Circuit",
  "Azure Cascade",
  "Pixel Rain",
  "Hollow Clockwork",
  "Starlight Parade",
  "Mono Chrome Dreams",
  "Velocity Garden",
  "Quiet Thunder",
];

let fakeActive = false;
let fakeJob: MirrorBatchJob | null = null;
let controller: FakeController | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getFakeSnapshot() {
  return fakeJob;
}

function getFakeActiveSnapshot() {
  return fakeActive;
}

function idleJob(): MirrorBatchJob {
  return {
    status: "idle",
    phase: "idle",
    mode: "pages",
    downloadDir: "~/Downloads/beatmaps",
    query: "(fake download)",
    startPage: 0,
    pageCount: 1,
    noVideo: true,
    excludeOwned: true,
    queued: 0,
    downloaded: 0,
    skippedExisting: 0,
    skippedOwned: 0,
    failed: 0,
    matched: 0,
    pagesScanned: 0,
    hitCap: false,
    savedForImport: 0,
    importScriptSh: null,
    importScriptBat: null,
    currentSetId: null,
    currentTitle: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    recentErrors: [],
  } as MirrorBatchJob;
}

function patchFake(partial: Partial<MirrorBatchJob>) {
  if (!fakeJob) fakeJob = idleJob();
  fakeJob = { ...fakeJob, ...partial };
  emit();
}

function clearTimer() {
  if (controller?.timer != null) {
    clearTimeout(controller.timer);
    controller.timer = null;
  }
}

function finishFake(status: "completed" | "error", error: string | null = null) {
  clearTimer();
  const downloaded = fakeJob?.downloaded ?? 0;
  patchFake({
    status,
    phase: "idle",
    currentSetId: null,
    currentTitle: null,
    finishedAt: new Date().toISOString(),
    error,
    savedForImport: downloaded,
  });
  fakeActive = false;
  controller = null;
  emit();
}

function schedule(fn: () => void, ms: number) {
  if (!controller) return;
  clearTimer();
  controller.timer = setTimeout(fn, ms);
}

function titleFor(index: number): string {
  return FAKE_TITLES[index % FAKE_TITLES.length]!;
}

/**
 * Client-only fake batch job that mirrors the real poll shape so progress UI,
 * ETA, stop, floating chip, and completion toasts can be exercised in dev.
 */
export function startFakeMirrorBatch(opts: FakeStartOptions) {
  if (fakeActive) {
    throw new Error("A fake download is already running");
  }

  const count = Math.max(1, Math.min(200, opts.count ?? 40));
  const delayMs =
    opts.preset === "fast" ? 180 : opts.preset === "fail" ? 220 : 1_200;
  const failAt =
    opts.preset === "fail" ? Math.max(5, Math.floor(count * 0.45)) : null;

  fakeActive = true;
  controller = { stopRequested: false, timer: null };
  const startedAt = new Date().toISOString();

  fakeJob = {
    ...idleJob(),
    status: "running",
    phase: "scanning",
    mode: "query",
    query: `fake:${opts.preset}`,
    matched: 0,
    pagesScanned: 0,
    startedAt,
    finishedAt: null,
    error: null,
    recentErrors: [],
    savedForImport: 0,
  };
  emit();

  let scanTicks = 0;
  const runScan = () => {
    if (!controller || controller.stopRequested) {
      finishFake("completed");
      return;
    }
    scanTicks += 1;
    patchFake({
      matched: Math.min(count, scanTicks * Math.ceil(count / 4)),
      pagesScanned: scanTicks,
    });
    if (scanTicks < 3) {
      schedule(runScan, 400);
      return;
    }

    patchFake({
      phase: "downloading",
      queued: count,
      matched: count,
      pagesScanned: 3,
      currentSetId: 900_001,
      currentTitle: titleFor(0),
    });
    schedule(() => stepDownload(0), delayMs);
  };

  const stepDownload = (index: number) => {
    if (!controller) return;
    if (controller.stopRequested) {
      finishFake("completed");
      return;
    }

    if (failAt != null && index >= failAt) {
      patchFake({
        failed: (fakeJob?.failed ?? 0) + 1,
        recentErrors: [
          {
            setId: 900_000 + index + 1,
            error: "Simulated mirror failure",
          },
        ],
      });
      finishFake("error", "Simulated mirror failure (dev fake download)");
      return;
    }

    if (index >= count) {
      finishFake("completed");
      return;
    }

    const setId = 900_001 + index;
    patchFake({
      downloaded: index + 1,
      currentSetId: setId,
      currentTitle: titleFor(index),
      savedForImport: index + 1,
    });

    if (index + 1 >= count) {
      finishFake("completed");
      return;
    }

    schedule(() => stepDownload(index + 1), delayMs);
  };

  schedule(runScan, 300);
  return getFakeSnapshot();
}

export function stopFakeMirrorBatch() {
  if (!fakeActive || !controller) {
    return getFakeSnapshot();
  }
  controller.stopRequested = true;
  patchFake({ status: "stopping" });
  schedule(() => finishFake("completed"), 350);
  return getFakeSnapshot();
}

export function isFakeMirrorBatchActive() {
  return fakeActive;
}

export function getFakeMirrorBatch() {
  return fakeJob;
}

export function useFakeMirrorBatch() {
  const job = useSyncExternalStore(
    subscribe,
    getFakeSnapshot,
    getFakeSnapshot,
  );
  const active = useSyncExternalStore(
    subscribe,
    getFakeActiveSnapshot,
    getFakeActiveSnapshot,
  );
  return { fakeJob: job, fakeActive: active };
}
