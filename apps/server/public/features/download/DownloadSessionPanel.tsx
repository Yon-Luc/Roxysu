import type { MirrorBatchJob } from "../../lib/api";
import {
  batchStatusLine,
  type estimateBatchEta,
} from "./batchProgress";

type Eta = ReturnType<typeof estimateBatchEta>;

export function DownloadSessionPanel({
  batch,
  phase,
  processed,
  progressPct,
  eta,
  stopping,
  onStop,
}: {
  batch: MirrorBatchJob;
  phase: string;
  processed: number;
  progressPct: number;
  eta: Eta;
  stopping: boolean;
  onStop: () => void;
}) {
  const queued = Number(batch.queued) || 0;
  const scanning = phase === "scanning";

  return (
    <section className="rx-panel space-y-4 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-semibold text-ink">Downloading maps</h2>
          <p className="text-sm text-ink">{batchStatusLine(batch)}</p>
          <p className="text-sm text-muted">
            {scanning
              ? "Building the download queue…"
              : queued > 0
                ? `${progressPct}% · ${processed.toLocaleString()} of ${queued.toLocaleString()}`
                : null}
            {eta && !scanning ? (
              <>
                {queued > 0 ? " · " : null}
                <span className={eta.ready ? "text-ink" : undefined}>
                  {eta.label}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="rx-btn shrink-0"
          disabled={stopping}
          onClick={onStop}
          title={
            batch.status === "stopping"
              ? "Force-clear a stuck download lock"
              : "Stop the current batch"
          }
        >
          {batch.status === "stopping" || stopping
            ? stopping
              ? "Stopping…"
              : "Force stop"
            : "Stop"}
        </button>
      </div>

      <div className="h-2.5 overflow-hidden rounded bg-elevated">
        <div
          className={`h-full bg-accent transition-[width] duration-500 ${
            scanning ? "w-1/3 animate-pulse" : ""
          }`}
          style={
            !scanning && queued > 0
              ? { width: `${progressPct}%` }
              : undefined
          }
        />
      </div>

      <p className="text-sm text-muted">
        You can still use other parts of the app while the download is going.
        A small progress chip stays available when you leave this page.
      </p>

      {batch.query ? (
        <p className="truncate text-xs text-faint">Query: {batch.query}</p>
      ) : null}
      {batch.error ? (
        <p className="text-sm text-danger">{batch.error}</p>
      ) : null}
      {batch.recentErrors.length > 0 ? (
        <ul className="text-xs text-faint">
          {batch.recentErrors.slice(0, 3).map((err) => (
            <li key={`${err.setId}-${err.error}`}>
              #{err.setId}: {err.error}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
