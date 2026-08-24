import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMirrorBatchJob,
  stopMirrorBatchJob,
  type MirrorBatchJob,
} from "../../lib/api";
import {
  batchProcessedCount,
  batchProgressPct,
  estimateBatchEta,
  isBatchBusy,
} from "./batchProgress";
import {
  isFakeMirrorBatchActive,
  stopFakeMirrorBatch,
  useFakeMirrorBatch,
} from "./fakeMirrorBatch";

export const MIRROR_BATCH_QUERY_KEY = ["mirrors", "batch"] as const;

export function useMirrorBatchJob() {
  const queryClient = useQueryClient();
  const { fakeJob, fakeActive } = useFakeMirrorBatch();

  const batchQuery = useQuery({
    queryKey: MIRROR_BATCH_QUERY_KEY,
    queryFn: fetchMirrorBatchJob,
    refetchInterval: (q) => {
      if (fakeActive) return false;
      const status = q.state.data?.status;
      return status === "running" || status === "stopping" ? 1000 : false;
    },
  });

  // `error` is a job field (`string | null`), not an API failure envelope.
  const batch: MirrorBatchJob | undefined = fakeActive
    ? (fakeJob ?? undefined)
    : (batchQuery.data ?? undefined);

  const busy = isBatchBusy(batch);
  const phase =
    batch && typeof batch.phase === "string" ? batch.phase : "idle";
  const processed = batchProcessedCount(batch);
  const progressPct = batchProgressPct(batch);

  const downloadingStartedAtMs = useDownloadingClock(batch, phase, busy);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!busy || phase !== "downloading") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy, phase]);

  const eta = estimateBatchEta({
    phase,
    queued: Number(batch?.queued) || 0,
    processed,
    downloadingStartedAtMs,
    nowMs,
  });

  const stopBatch = useMutation({
    mutationFn: async () => {
      if (isFakeMirrorBatchActive()) {
        return stopFakeMirrorBatch();
      }
      return stopMirrorBatchJob();
    },
    onSuccess: (data) => {
      if (data && !isFakeMirrorBatchActive()) {
        queryClient.setQueryData(MIRROR_BATCH_QUERY_KEY, data);
      }
    },
  });

  return {
    batch,
    busy,
    phase,
    processed,
    progressPct,
    eta,
    isFake: fakeActive,
    stopBatch,
    refetch: batchQuery.refetch,
    queryClient,
  };
}

/** Prefer the server download-phase epoch; local clock is only a fallback. */
function useDownloadingClock(
  batch: MirrorBatchJob | undefined,
  phase: string,
  busy: boolean,
): number | null {
  const [fallbackMs, setFallbackMs] = useState<number | null>(null);
  const jobKeyRef = useRef<string | null>(null);

  const jobKey = batch?.startedAt ?? null;
  const serverMs = parseIsoMs(batch?.downloadingStartedAt);

  useEffect(() => {
    if (jobKey !== jobKeyRef.current) {
      jobKeyRef.current = jobKey;
      setFallbackMs(null);
    }
  }, [jobKey]);

  useEffect(() => {
    if (!busy) {
      setFallbackMs(null);
      return;
    }
    if (phase === "downloading" && serverMs == null) {
      setFallbackMs((prev) => prev ?? Date.now());
    }
  }, [busy, phase, serverMs]);

  if (!busy || phase !== "downloading") return null;
  return serverMs ?? fallbackMs;
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
