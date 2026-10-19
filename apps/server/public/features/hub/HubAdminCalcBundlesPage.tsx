import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoBackLink } from "../../components/GoBackLink";
import { ListSkeleton } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { APP_VERSION } from "../../lib/appVersion";
import {
  exportUploadCalcBundle,
  fetchCalcBundleStatus,
} from "../../lib/api";
import { formatRelativeTime } from "../../lib/format";
import {
  deleteHubAdminCalcBundle,
  fetchHubAdminCalcBundles,
  fetchHubMe,
  useHubJwt,
  useHubUrl,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { HubLoginButton } from "./HubLoginButton";

export function HubAdminCalcBundlesPage() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(APP_VERSION);
  const [label, setLabel] = useState("");

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const isAdmin = meQuery.data?.role === "admin";

  const localStatus = useQuery({
    queryKey: ["calc-bundle-status"],
    queryFn: fetchCalcBundleStatus,
  });

  const bundlesQuery = useQuery({
    queryKey: ["hub-admin-calc-bundles", hubUrl, jwt],
    enabled: !!jwt && isAdmin,
    queryFn: () => fetchHubAdminCalcBundles(hubUrl, jwt!),
  });

  const uploadMutation = useMutation({
    mutationFn: () =>
      exportUploadCalcBundle({
        token: jwt!,
        roxysuVersion: version.trim(),
        label: label.trim() || undefined,
      }),
    onSuccess: (data) => {
      if (!data.ok) {
        pushToast({
          tone: "error",
          title: "Upload failed",
          detail: data.message,
        });
        return;
      }
      pushToast({
        tone: "success",
        title: "Calc bundle uploaded",
        detail: `${data.entryCount} entries in ${data.chunks} chunk(s)`,
      });
      void queryClient.invalidateQueries({
        queryKey: ["hub-admin-calc-bundles"],
      });
    },
    onError: (err: Error) => {
      pushToast({
        tone: "error",
        title: "Upload failed",
        detail: err.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (v: string) => deleteHubAdminCalcBundle(hubUrl, jwt!, v),
    onSuccess: () => {
      pushToast({ tone: "success", title: "Calc bundle deleted" });
      void queryClient.invalidateQueries({
        queryKey: ["hub-admin-calc-bundles"],
      });
    },
    onError: (err: Error) => {
      pushToast({
        tone: "error",
        title: "Delete failed",
        detail: err.message,
      });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <GoBackLink to="/hub">Community</GoBackLink>
          <PageTitle>Hub calc bundles</PageTitle>
          <p className="text-sm text-muted">
            Publish Sunny / Daniel / Rework dan and dominant-skill rows from
            this machine for a Roxysu product version. Clients pull the bundle
            matching their version on boot.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/hub/admin/cache" className="rx-btn text-sm">
            Search index
          </Link>
          {!jwt ? <HubLoginButton /> : null}
        </div>
      </div>

      {!jwt ? (
        <p className="text-sm text-muted">Sign in as a Hub admin to manage bundles.</p>
      ) : meQuery.isLoading ? (
        <ListSkeleton count={3} />
      ) : !isAdmin ? (
        <p className="text-sm text-danger">Admin access required.</p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-elevated/40 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
              Upload from local mirror
            </h2>
            <p className="text-sm text-muted">
              Local exportable rows:{" "}
              <span className="text-ink">
                {localStatus.data?.exportCount ?? "…"}
              </span>
              . App version:{" "}
              <span className="text-ink">{APP_VERSION}</span>
              {localStatus.data?.appliedVersion
                ? ` · applied Hub version: ${localStatus.data.appliedVersion}`
                : null}
            </p>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Target Roxysu version</span>
              <input
                className="rx-input w-full"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="0.1.17"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">Label (optional)</span>
              <input
                className="rx-input w-full"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Pre-release rework + pattern"
              />
            </label>
            <button
              type="button"
              className="rx-btn rx-btn-primary"
              disabled={
                uploadMutation.isPending || !version.trim() || !jwt
              }
              onClick={() => uploadMutation.mutate()}
            >
              {uploadMutation.isPending ? "Uploading…" : "Export & upload"}
            </button>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
              Published bundles
            </h2>
            {bundlesQuery.isLoading ? (
              <ListSkeleton count={4} />
            ) : bundlesQuery.data?.length === 0 ? (
              <p className="text-sm text-muted">No calc bundles yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {bundlesQuery.data?.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-start justify-between gap-3 p-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-ink">{b.roxysuVersion}</p>
                      <p className="text-xs text-muted">
                        {b.entryCount} entries
                        {b.label ? ` · ${b.label}` : ""}
                        {b.algorithms.length
                          ? ` · ${b.algorithms.join(", ")}`
                          : ""}
                      </p>
                      <p className="text-xs text-faint">
                        {formatRelativeTime(b.uploadedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rx-btn text-xs"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (
                          !confirm(
                            `Delete Hub calc bundle for ${b.roxysuVersion}?`,
                          )
                        ) {
                          return;
                        }
                        deleteMutation.mutate(b.roxysuVersion);
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
