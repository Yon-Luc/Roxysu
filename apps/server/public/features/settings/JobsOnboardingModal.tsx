import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  completeJobsOnboarding,
  fetchJobsOnboarding,
  fetchSystemStatus,
} from "../../lib/api";
import { pushToast } from "../../lib/toasts";

/**
 * After the first meaningful sync, explain dan/pattern backfills and offer
 * to start Sunny + Daniel + Rework (pattern included via rework).
 */
export function JobsOnboardingModal() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const onboardingQuery = useQuery({
    queryKey: ["jobs-onboarding"],
    queryFn: fetchJobsOnboarding,
    staleTime: 30_000,
  });

  const statusQuery = useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (onboardingQuery.data?.completed) {
      setOpen(false);
      return;
    }
    const beatmaps = statusQuery.data?.beatmapCount ?? 0;
    const lastImport = statusQuery.data?.lastImport;
    const syncDone =
      lastImport?.status === "success" ||
      (lastImport != null && (lastImport.beatmapsUpserted ?? 0) > 0);
    if (!onboardingQuery.isLoading && beatmaps > 0 && syncDone) {
      setOpen(true);
    }
  }, [
    onboardingQuery.data?.completed,
    onboardingQuery.isLoading,
    statusQuery.data?.beatmapCount,
    statusQuery.data?.lastImport,
  ]);

  const mutation = useMutation({
    mutationFn: completeJobsOnboarding,
    onSuccess: (data) => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["jobs-onboarding"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (data.started) {
        pushToast({
          tone: "success",
          title: "Jobs started",
          detail: "Sunny, Daniel, and Rework dan are running in the background.",
          action: {
            label: "Open Jobs",
            onClick: () => {
              window.location.hash = "#/settings?tab=jobs";
            },
          },
        });
      }
    },
    onError: (err: Error) => {
      pushToast({
        tone: "error",
        title: "Could not update Jobs onboarding",
        detail: err.message,
      });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="jobs-onboarding-title"
        className="w-full max-w-md rounded-lg border border-border bg-elevated p-5 shadow-xl"
      >
        <h2
          id="jobs-onboarding-title"
          className="text-lg font-semibold text-ink"
        >
          Analyze your maps?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Roxysu can estimate Sunny dan, Daniel dan, Rework dan, and dominant
          skill for your mania library. This runs in the background, pauses
          automatically when memory is low, and may use precomputed results
          from the Hub for this app version when available.
        </p>
        <p className="mt-2 text-sm text-muted">
          You can start or stop these anytime from Settings → Jobs.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rx-btn"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ completed: true, startJobs: false })
            }
          >
            Not now
          </button>
          <button
            type="button"
            className="rx-btn rx-btn-primary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({ completed: true, startJobs: true })
            }
          >
            {mutation.isPending ? "Starting…" : "Start analysis"}
          </button>
        </div>
      </div>
    </div>
  );
}
