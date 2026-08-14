import { useEffect, useRef } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { pushToast } from "../../lib/toasts";
import { batchProcessedCount, batchStatusLine } from "./batchProgress";
import { useMirrorBatchJob } from "./useMirrorBatchJob";

/**
 * App-wide download chrome: completion toasts + floating progress when away
 * from `/download-maps`.
 */
export function DownloadBatchChrome() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onDownloadPage = pathname === "/download-maps";
  const { batch, busy, phase, progressPct, eta, stopBatch, isFake } =
    useMirrorBatchJob();

  useBatchCompletionToasts(batch, busy, isFake);

  if (!busy || !batch || onDownloadPage) return null;
  if (typeof document === "undefined") return null;

  const scanning = phase === "scanning";
  const queued = Number(batch.queued) || 0;

  return createPortal(
    <div className="fixed bottom-20 right-4 z-55 w-72 max-w-[calc(100vw-2rem)] md:bottom-4">
      <div className="rounded-lg border border-border bg-elevated/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <Link
            to="/download-maps"
            className="min-w-0 flex-1 space-y-0.5 no-underline"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">
              Download
            </p>
            <p className="truncate text-sm text-ink">{batchStatusLine(batch)}</p>
            <p className="text-xs text-muted">
              {scanning
                ? "Scanning…"
                : queued > 0
                  ? `${progressPct}%`
                  : null}
              {eta && !scanning ? ` · ${eta.label}` : null}
            </p>
          </Link>
          <button
            type="button"
            className="rx-btn shrink-0 px-2 py-1 text-xs"
            disabled={stopBatch.isPending}
            title={
              batch.status === "stopping"
                ? "Force-clear a stuck download lock"
                : "Stop the current batch"
            }
            onClick={() => stopBatch.mutate()}
          >
            {stopBatch.isPending
              ? "…"
              : batch.status === "stopping"
                ? "Force"
                : "Stop"}
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-canvas">
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
      </div>
    </div>,
    document.body,
  );
}

function useBatchCompletionToasts(
  batch: ReturnType<typeof useMirrorBatchJob>["batch"],
  busy: boolean,
  isFake: boolean,
) {
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevBusyRef = useRef(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const wasBusy = prevBusyRef.current;
    const status = batch?.status;

    prevStatusRef.current = status;
    prevBusyRef.current = busy;

    if (!batch || !wasBusy || busy) return;
    if (status !== "completed" && status !== "error") return;
    // Avoid toasting on first mount if a finished job is already in memory.
    if (prevStatus !== "running" && prevStatus !== "stopping") return;

    const downloaded = Number(batch.downloaded) || 0;
    const queued = Number(batch.queued) || 0;
    const processed = batchProcessedCount(batch);
    const stoppedEarly =
      status === "completed" && queued > 0 && processed < queued;

    if (status === "error") {
      pushToast({
        title: isFake ? "Fake download failed" : "Download failed",
        detail: batch.error ?? "Something went wrong while downloading.",
        tone: "error",
      });
      return;
    }

    pushToast({
      title: stoppedEarly
        ? isFake
          ? "Fake download stopped"
          : "Download stopped"
        : isFake
          ? "Fake download finished"
          : "Download finished",
      detail:
        downloaded > 0
          ? `${downloaded.toLocaleString()} map${downloaded === 1 ? "" : "s"} saved${
              stoppedEarly && queued > 0
                ? ` · ${processed.toLocaleString()} of ${queued.toLocaleString()} processed`
                : ""
            }`
          : stoppedEarly
            ? "Stopped before any maps were saved."
            : "No new maps were saved.",
      tone: "success",
      action: {
        label: "Open Download",
        onClick: () => {
          window.location.hash = "#/download-maps";
        },
      },
    });
  }, [batch, busy, isFake]);
}
