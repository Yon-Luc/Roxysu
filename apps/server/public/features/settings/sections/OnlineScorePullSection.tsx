import { useEffect, useId, useState } from "react";
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

type LocalPlayer = { username: string; osuId: number; count: number };

type LocalUser = {
  ok: boolean;
  error: string | null;
  username: string | null;
  osuId: number | null;
  players: LocalPlayer[];
  waiting: { waiting: number };
};

type Copy = Record<string, string | undefined> | undefined;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data;
}

function Stat({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint?: string;
  tone: "ink" | "muted" | "accent" | "warning";
}) {
  const toneClass = {
    ink: "text-ink",
    muted: "text-muted",
    accent: "text-accent",
    warning: "text-warning",
  }[tone];
  return (
    <div className="rounded-xl bg-base/70 px-3 py-3">
      <div className={`font-display text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">{label}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function PullModal({
  open,
  looking,
  progress,
  preview,
  error,
  confirming,
  writing,
  done,
  copy,
  onClose,
  onConfirmAsk,
  onConfirmBack,
  onCommit,
}: {
  open: boolean;
  looking: boolean;
  progress: string | null;
  preview: Preview | null;
  error: string | null;
  confirming: boolean;
  writing: boolean;
  done: { added: number; backupPath: string } | null;
  copy: Copy;
  onClose: () => void;
  onConfirmAsk: () => void;
  onConfirmBack: () => void;
  onCommit: () => void;
}) {
  const titleId = useId();
  const addable = preview ? preview.add + preview.currentVersion : 0;
  const busy = looking || writing;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="page-enter w-full max-w-lg rounded-2xl bg-elevated shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            {looking
              ? (copy?.onlineScorePullFetching ?? "Looking up ranked bests")
              : done
                ? (copy?.onlineScorePullDone ?? "Added")
                : confirming
                  ? (copy?.onlineScorePullCloseLazer ?? "Close osu!lazer")
                  : (copy?.onlineScorePull ?? "Ranked bests")}
          </h2>
          {preview && !looking && !confirming && !done ? (
            <p className="mt-1 text-sm text-muted">
              {preview.username}
              {preview.fromCache ? " · cached" : ""}
            </p>
          ) : null}
        </div>

        <div className="px-5 py-5">
          {looking ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="relative h-16 w-16">
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
                <div className="absolute inset-2 animate-pulse rounded-full bg-accent/15" />
              </div>
              <p className="mt-5 text-sm font-semibold text-ink">
                {copy?.onlineScorePullFetching ?? "Checking osu!"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {progress ?? (copy?.onlineScorePullLooking ?? "This can take a moment.")}
              </p>
            </div>
          ) : null}

          {error && !looking ? (
            <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
          ) : null}

          {preview && !looking && !confirming && !done ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat
                value={preview.found}
                label={copy?.onlineScorePullFound ?? "Found"}
                hint={preview.fromCache ? "From the Hub store" : "Fresh from osu!"}
                tone="ink"
              />
              <Stat
                value={preview.already}
                label={copy?.onlineScorePullAlready ?? "Already in lazer"}
                tone="muted"
              />
              <Stat
                value={addable}
                label={copy?.onlineScorePullCanAdd ?? "Can add"}
                hint={
                  preview.currentVersion > 0
                    ? `${preview.currentVersion} ${copy?.onlineScorePullCurrentVersion ?? "set on an older version of the map"}`
                    : undefined
                }
                tone="accent"
              />
              <Stat
                value={preview.skipped}
                label={copy?.onlineScorePullSkipped ?? "Map not installed"}
                tone="warning"
              />
            </div>
          ) : null}

          {confirming && !done ? (
            <div className="page-enter space-y-2 text-sm">
              <p className="font-semibold text-ink">
                {copy?.onlineScorePullCloseLazer ?? "Close osu!lazer before continuing."}
              </p>
              <p className="text-muted">
                {copy?.onlineScorePullBackup ??
                  "Roxysu copies client.realm first and keeps the last 5 backups. Scores show in-game without a replay."}
              </p>
            </div>
          ) : null}

          {done ? (
            <div className="page-enter space-y-2 text-sm">
              <p className="text-lg font-bold text-ink">
                {done.added} {copy?.onlineScorePullDone ?? "added"}
              </p>
              <p className="break-all text-muted">{done.backupPath}</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/5 px-5 py-4">
          {confirming && !done ? (
            <button type="button" className="rx-btn" disabled={writing} onClick={onConfirmBack}>
              {copy?.onlineScorePullCancel ?? "Back"}
            </button>
          ) : (
            <button type="button" className="rx-btn" disabled={busy} onClick={onClose}>
              {copy?.onlineScorePullCancel ?? "Close"}
            </button>
          )}
          {preview && !looking && !confirming && !done && addable > 0 ? (
            <button type="button" className="rx-btn-primary" onClick={onConfirmAsk}>
              {copy?.onlineScorePullAdd ?? "Add to lazer"} · {addable}
            </button>
          ) : null}
          {confirming && !done ? (
            <button type="button" className="rx-btn-primary" disabled={writing} onClick={onCommit}>
              {writing
                ? (copy?.onlineScorePullWriting ?? "Writing…")
                : (copy?.onlineScorePullConfirm ?? "Lazer is closed — add scores")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OnlineScorePullSection() {
  const { dict } = useAppDict();
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();
  const [ruleset, setRuleset] = useState<(typeof RULESETS)[number]["id"]>("mania");
  const [player, setPlayer] = useState("");
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const localUser = useQuery({
    queryKey: ["online-scores", "user"],
    queryFn: () => api<LocalUser>("/api/online-scores/user"),
  });

  useEffect(() => {
    const first = localUser.data?.players[0]?.username;
    if (!player && first) setPlayer(first);
  }, [localUser.data, player]);

  const me = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    enabled: Boolean(jwt),
  });

  const previewMut = useMutation({
    mutationFn: (force: boolean) =>
      api<Preview>("/api/online-scores/preview", {
        method: "POST",
        body: JSON.stringify({
          hubJwt: getHubJwt(),
          ruleset,
          force,
          username: player || undefined,
        }),
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
          const budget = calls != null && limit != null ? ` · ${calls}/${limit} this minute` : "";
          setProgress(`${data.scoreCount ?? 0} scores · ${data.pagesFetched ?? 0} pages${budget}`);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [previewMut.isPending, jwt, hubUrl, ruleset]);

  const copy = dict?.settings as Copy;
  const players = localUser.data?.players ?? [];
  const selected =
    players.find((row) => row.username === player) ??
    (players.length === 1 ? players[0] : undefined);
  const mismatch = Boolean(me.data && selected && me.data.osuId !== selected.osuId);
  const canPull = Boolean(jwt) && Boolean(selected) && !mismatch;

  function start(force: boolean) {
    setOpen(true);
    setConfirming(false);
    setPreview(null);
    commitMut.reset();
    previewMut.mutate(force);
  }

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

      <div className="mt-4 flex flex-wrap gap-3">
        {players.length > 1 ? (
          <label className="text-sm text-muted">
            {copy?.onlineScorePullPlayer ?? "Player"}
            <select
              className="mt-1 block rounded-lg bg-elevated px-3 py-2 text-ink"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
            >
              {players.map((row) => (
                <option key={row.username} value={row.username}>
                  {row.username}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm text-muted">
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
      </div>

      {players.length === 0 && localUser.data?.error ? (
        <p className="mt-3 text-sm text-danger">{localUser.data.error}</p>
      ) : null}
      {mismatch && selected ? (
        <p className="mt-3 text-sm text-danger">
          {copy?.onlineScorePullMismatch ??
            `Hub is ${me.data?.username}. Lazer scores belong to ${selected.username}. Log in as that player.`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rx-btn-primary"
          disabled={!canPull || previewMut.isPending}
          onClick={() => start(false)}
        >
          {copy?.onlineScorePullCheck ?? "Check ranked bests"}
        </button>
        {preview && !open ? (
          <button type="button" className="rx-btn" onClick={() => setOpen(true)}>
            {copy?.onlineScorePullView ?? "View results"}
          </button>
        ) : null}
      </div>

      <PullModal
        open={open}
        looking={previewMut.isPending}
        progress={progress}
        preview={preview}
        error={previewMut.isError ? previewMut.error.message : commitMut.isError ? commitMut.error.message : null}
        confirming={confirming}
        writing={commitMut.isPending}
        done={commitMut.data ?? null}
        copy={copy}
        onClose={() => {
          if (previewMut.isPending || commitMut.isPending) return;
          setOpen(false);
          setConfirming(false);
        }}
        onConfirmAsk={() => setConfirming(true)}
        onConfirmBack={() => setConfirming(false)}
        onCommit={() => commitMut.mutate()}
      />
    </section>
  );
}
