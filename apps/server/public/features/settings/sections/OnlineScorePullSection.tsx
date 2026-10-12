import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HubLoginButton } from "../../hub/HubLoginButton";
import { pageSectionDomId } from "../../../lib/pageSections";
import { fetchHubMe, getHubJwt, useHubJwt, useHubUrl } from "../../../lib/hub";
import { useAppDict } from "../../../lib/i18n";

const RULESETS = [
  { id: "mania", label: "mania" },
  { id: "osu", label: "osu" },
  { id: "taiko", label: "taiko" },
  { id: "fruits", label: "catch" },
] as const;

type Preview = {
  found: number;
  already: number;
  add: number;
  currentVersion: number;
  skipped: number;
  username: string;
  fromCache: boolean;
  budget?: { callsThisMinute?: number; limitPerMinute?: number; parked?: boolean };
};

type LocalUser =
  | { ok: true; osuId: number; username: string; waiting: { waiting: number } }
  | { ok: false; error: string; waiting: { waiting: number } };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data;
}

export function OnlineScorePullSection() {
  const { dict } = useAppDict();
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();
  const [ruleset, setRuleset] = useState<(typeof RULESETS)[number]["id"]>("mania");
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const localUser = useQuery({
    queryKey: ["online-scores", "user"],
    queryFn: () => api<LocalUser>("/api/online-scores/user"),
  });
  const me = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    enabled: Boolean(jwt),
  });

  const previewMut = useMutation({
    mutationFn: (force: boolean) =>
      api<Preview>("/api/online-scores/preview", {
        method: "POST",
        body: JSON.stringify({ hubJwt: getHubJwt(), ruleset, force }),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setConfirming(false);
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: ["online-scores", "user"] });
    },
  });

  const commitMut = useMutation({
    mutationFn: () =>
      api<{ added: number; backupPath: string }>("/api/online-scores/commit", {
        method: "POST",
      }),
    onSuccess: () => {
      setConfirming(false);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["online-scores", "user"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  useEffect(() => {
    if (!previewMut.isPending || !jwt) return;
    const timer = setInterval(() => {
      void fetch(
        `${hubUrl.replace(/\/$/, "")}/osu/scores/progress?ruleset=${ruleset}`,
        { headers: { Authorization: `Bearer ${jwt}` } },
      )
        .then((res) => res.json())
        .then((data: { pagesFetched?: number; scoreCount?: number; budget?: { callsThisMinute?: number; limitPerMinute?: number } }) => {
          const calls = data.budget?.callsThisMinute;
          const limit = data.budget?.limitPerMinute;
          const budget = calls != null && limit != null ? ` · upstream ${calls}/${limit}` : "";
          setProgress(`${data.pagesFetched ?? 0} pages · ${data.scoreCount ?? 0} scores${budget}`);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [previewMut.isPending, jwt, hubUrl, ruleset]);

  const copy = dict?.settings as unknown as Record<string, string | undefined> | undefined;
  const mismatch =
    me.data && localUser.data?.ok && me.data.osuId !== localUser.data.osuId;
  const canPull = Boolean(jwt) && localUser.data?.ok && !mismatch;
  const addable = preview ? preview.add + preview.currentVersion : 0;

  return (
    <section id={pageSectionDomId("online-score-pull")} className="rx-panel scroll-mt-6 p-5">
      <h2 className="text-sm font-bold text-ink">
        {copy?.onlineScorePull ?? "Online score pull"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {copy?.onlineScorePullDesc ??
          "Fetch ranked personal bests from osu! and add the ones missing from lazer. Loved and pending maps are not included."}
      </p>

      {!jwt ? (
        <div className="mt-4">
          <HubLoginButton />
        </div>
      ) : null}

      {localUser.data && !localUser.data.ok ? (
        <p className="mt-3 text-sm text-danger">{localUser.data.error}</p>
      ) : null}

      {mismatch && localUser.data?.ok ? (
        <p className="mt-3 text-sm text-danger">
          {copy?.onlineScorePullMismatch ??
            `Hub is ${me.data?.username}. Lazer scores belong to ${localUser.data.username}. Log in as that player.`}
        </p>
      ) : null}

      <label className="mt-4 block text-sm text-muted">
        {copy?.onlineScorePullRuleset ?? "Ruleset"}
        <select
          className="mt-1 block rounded-lg bg-elevated px-3 py-2 text-ink"
          value={ruleset}
          onChange={(e) => setRuleset(e.target.value as (typeof RULESETS)[number]["id"])}
        >
          {RULESETS.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={!canPull || previewMut.isPending}
          onClick={() => previewMut.mutate(false)}
        >
          {previewMut.isPending
            ? (copy?.onlineScorePullFetching ?? "Fetching…")
            : (copy?.onlineScorePullCheck ?? "Check ranked bests")}
        </button>
        <button
          type="button"
          className="rx-btn"
          disabled={!canPull || previewMut.isPending}
          onClick={() => previewMut.mutate(true)}
        >
          {copy?.onlineScorePullForce ?? "Force refresh"}
        </button>
      </div>

      {progress && previewMut.isPending ? (
        <p className="mt-2 text-sm text-muted">{progress}</p>
      ) : null}
      {previewMut.error ? (
        <p className="mt-3 text-sm text-danger">{previewMut.error.message}</p>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-1 text-sm text-ink">
          <p>
            {(copy?.onlineScorePullFound ?? "Found")} {preview.found}
            {preview.fromCache ? " (cached)" : ""}
          </p>
          <p>
            {(copy?.onlineScorePullAlready ?? "Already in lazer")} {preview.already}
          </p>
          <p>
            {(copy?.onlineScorePullCanAdd ?? "Can add")} {preview.add}
          </p>
          <p>
            {(copy?.onlineScorePullCurrentVersion ?? "Added on current map version")}{" "}
            {preview.currentVersion}
          </p>
          <p>
            {(copy?.onlineScorePullSkipped ?? "Map not installed")} {preview.skipped}
          </p>
          {preview.budget?.callsThisMinute != null ? (
            <p className="text-muted">
              upstream {preview.budget.callsThisMinute}/{preview.budget.limitPerMinute ?? 50}
            </p>
          ) : null}
        </div>
      ) : null}

      {addable > 0 && !confirming ? (
        <button type="button" className="rx-btn-primary mt-4" onClick={() => setConfirming(true)}>
          {copy?.onlineScorePullAdd ?? `Add ${addable} to lazer`}
        </button>
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-xl bg-elevated/60 p-4 text-sm">
          <p className="font-bold text-ink">
            {copy?.onlineScorePullCloseLazer ?? "Close osu!lazer before continuing."}
          </p>
          <p className="mt-1 text-muted">
            {copy?.onlineScorePullBackup ??
              "Roxysu copies client.realm first and keeps the last 5 backups. Scores show in-game without a replay."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rx-btn-primary"
              disabled={commitMut.isPending}
              onClick={() => commitMut.mutate()}
            >
              {commitMut.isPending
                ? (copy?.onlineScorePullWriting ?? "Writing…")
                : (copy?.onlineScorePullConfirm ?? "Lazer is closed — add scores")}
            </button>
            <button type="button" className="rx-btn" onClick={() => setConfirming(false)}>
              {copy?.onlineScorePullCancel ?? "Cancel"}
            </button>
          </div>
        </div>
      ) : null}

      {commitMut.error ? (
        <p className="mt-3 text-sm text-danger">{commitMut.error.message}</p>
      ) : null}
      {commitMut.data ? (
        <p className="mt-3 text-sm text-ink">
          {(copy?.onlineScorePullDone ?? "Added")} {commitMut.data.added}.{" "}
          {commitMut.data.backupPath}
        </p>
      ) : null}
    </section>
  );
}
