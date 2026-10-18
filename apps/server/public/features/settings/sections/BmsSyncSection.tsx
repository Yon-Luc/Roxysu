import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HubLoginButton } from "../../hub/HubLoginButton";
import { pageSectionDomId } from "../../../lib/pageSections";
import { getHubJwt, useHubJwt } from "../../../lib/hub";
import { useAppDict } from "../../../lib/i18n";
import { fetchBmsSync, patchBmsSync, retryBmsSync } from "../../bms/api";

export function BmsSyncSection() {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const token = useHubJwt();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["bms-sync"], queryFn: fetchBmsSync });
  const save = useMutation({
    mutationFn: patchBmsSync,
    onSuccess: (data) => queryClient.setQueryData(["bms-sync"], data),
  });
  const retry = useMutation({
    mutationFn: retryBmsSync,
    onSuccess: (data) => queryClient.setQueryData(["bms-sync"], data),
  });
  const data = status.data;
  const error = save.error instanceof Error ? save.error.message : null;

  function toggle(key: "autoUpload" | "historicalUpload", value: boolean) {
    save.mutate({
      [key]: value,
      hubJwt: value ? getHubJwt() : undefined,
    });
  }

  return (
    <section id={pageSectionDomId("bms-upload")} className="rx-panel scroll-mt-6 p-5">
      <h2 className="font-display text-lg font-semibold">{copy?.syncTitle ?? "BMS upload"}</h2>
      <p className="mt-1 text-sm text-muted">{copy?.syncHelp}</p>
      {!token ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm">{copy?.loginRequired ?? "Log in to the Hub before uploading."}</p>
          <HubLoginButton />
        </div>
      ) : null}
      {data?.authPaused ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-warning">
            {copy?.authPaused ?? "Hub login expired. Log in again to resume uploads."}
          </p>
          <HubLoginButton />
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data?.autoUpload ?? false}
            onChange={(event) => toggle("autoUpload", event.target.checked)}
          />
          {copy?.autoUpload ?? "Upload new scores"}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data?.historicalUpload ?? false}
            onChange={(event) => toggle("historicalUpload", event.target.checked)}
          />
          {copy?.historical ?? "Upload existing scores"}
        </label>
      </div>
      {data ? (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-muted">{copy?.pending ?? "Waiting"}</dt>
            <dd className="tabular-nums">{data.counts.pending}</dd>
          </div>
          <div>
            <dt className="text-muted">{copy?.retryWait ?? "Retry later"}</dt>
            <dd className="tabular-nums">{data.counts.retryWait}</dd>
          </div>
          <div>
            <dt className="text-muted">{copy?.synced ?? "Uploaded"}</dt>
            <dd className="tabular-nums">{data.counts.synced}</dd>
          </div>
          <div>
            <dt className="text-muted">{copy?.rejected ?? "Rejected"}</dt>
            <dd className="tabular-nums">{data.counts.rejected}</dd>
          </div>
          <div>
            <dt className="text-muted">{data.backfill}</dt>
            <dd className="tabular-nums">{data.counts.uploading}</dd>
          </div>
        </dl>
      ) : null}
      <button
        type="button"
        className="rx-btn mt-4"
        disabled={(data?.counts.retryWait ?? 0) === 0 || retry.isPending}
        onClick={() => retry.mutate()}
      >
        {copy?.retry ?? "Retry waiting scores"}
      </button>
      {error ? <p className="mt-2 text-sm text-warning">{error}</p> : null}
    </section>
  );
}
