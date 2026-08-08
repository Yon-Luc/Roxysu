import type { MirrorBatchJob } from "../../lib/api";

/** Maps processed in the current batch (saved + already on disk + failed). */
export function batchProcessedCount(
  batch: Pick<
    MirrorBatchJob,
    "downloaded" | "skippedExisting" | "failed"
  > | null | undefined,
): number {
  if (!batch) return 0;
  return (
    (Number(batch.downloaded) || 0) +
    (Number(batch.skippedExisting) || 0) +
    (Number(batch.failed) || 0)
  );
}

export function batchProgressPct(
  batch: Pick<
    MirrorBatchJob,
    "queued" | "downloaded" | "skippedExisting" | "failed"
  > | null | undefined,
): number {
  if (!batch || !(Number(batch.queued) > 0)) return 0;
  return Math.min(
    100,
    Math.round((batchProcessedCount(batch) / batch.queued) * 100),
  );
}

export function isBatchBusy(
  batch: Pick<MirrorBatchJob, "status"> | null | undefined,
): boolean {
  return batch?.status === "running" || batch?.status === "stopping";
}

/** Minimum completed maps before we trust a rate-based ETA. */
export const ETA_MIN_SAMPLES = 10;

export function formatEtaMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Almost done";
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `~${totalSec}s left`;
  const totalMin = Math.ceil(totalSec / 60);
  if (totalMin < 60) return `~${totalMin}m left`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 10) return ">10h left";
  return mins > 0 ? `~${hours}h ${mins}m left` : `~${hours}h left`;
}

/**
 * Estimate remaining download time from average map duration since
 * `downloadingStartedAtMs`. Returns null while still warming up / scanning.
 */
export function estimateBatchEta(opts: {
  phase: string | undefined;
  queued: number;
  processed: number;
  downloadingStartedAtMs: number | null;
  nowMs?: number;
}): { label: string; ready: boolean } | null {
  const { phase, queued, processed, downloadingStartedAtMs } = opts;
  const nowMs = opts.nowMs ?? Date.now();

  if (phase === "scanning") {
    return { label: "Estimating…", ready: false };
  }
  if (phase !== "downloading" || queued <= 0) return null;
  if (
    processed < ETA_MIN_SAMPLES ||
    downloadingStartedAtMs == null ||
    processed >= queued
  ) {
    return { label: "Estimating…", ready: false };
  }

  const elapsed = Math.max(0, nowMs - downloadingStartedAtMs);
  const avg = elapsed / processed;
  const remaining = avg * (queued - processed);
  return { label: formatEtaMs(remaining), ready: true };
}

export function batchStatusLine(batch: MirrorBatchJob): string {
  const phase =
    typeof batch.phase === "string" ? batch.phase : "idle";
  const processed = batchProcessedCount(batch);

  if (batch.status === "stopping") return "Stopping…";

  if (phase === "scanning") {
    const matched = Number(batch.matched) || 0;
    const pages = Number(batch.pagesScanned) || 0;
    return (
      `Scanning mirror… ${matched.toLocaleString()} matched` +
      (pages > 0 ? ` · ${pages} page${pages === 1 ? "" : "s"}` : "")
    );
  }

  if (phase === "downloading" || batch.status === "running") {
    const current =
      batch.currentTitle ||
      (batch.currentSetId ? `#${batch.currentSetId}` : null);
    return (
      `Downloading ${processed.toLocaleString()} / ${(Number(batch.queued) || 0).toLocaleString()}` +
      (current ? ` · ${current}` : "")
    );
  }

  if (batch.status === "completed") {
    return `Finished · ${(Number(batch.downloaded) || 0).toLocaleString()} saved`;
  }
  if (batch.status === "error") {
    return batch.error ? `Failed · ${batch.error}` : "Failed";
  }
  return `Batch · ${batch.status}`;
}

/** True outside production UI bundles (Bun fullstack / local). */
export function isDevUi(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}
