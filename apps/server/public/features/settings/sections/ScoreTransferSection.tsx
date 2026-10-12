import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

type Preview = {
  found: number;
  already: number;
  add: number;
  currentVersion: number;
  skipped: number;
  invalid: number;
};

type Copy = Record<string, string | undefined> | undefined;

async function readPreview(file: File): Promise<Preview> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/score-transfer/preview", { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as Preview & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
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

export function ScoreTransferSection() {
  const { dict } = useAppDict();
  const copy = dict?.settings as Copy;
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const previewMut = useMutation({
    mutationFn: readPreview,
    onSuccess: (data) => {
      setPreview(data);
      setConfirming(false);
    },
  });

  const commitMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/score-transfer/commit", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        added: number;
        backupPath: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const addable = preview ? preview.add + preview.currentVersion : 0;
  const busy = previewMut.isPending || commitMut.isPending;
  const error = previewMut.isError
    ? previewMut.error.message
    : commitMut.isError
      ? commitMut.error.message
      : null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy]);

  return (
    <section id={pageSectionDomId("score-transfer")} className="rx-panel scroll-mt-6 p-5">
      <h2 className="text-sm font-bold text-ink">{copy?.scoreTransfer ?? "Score transfer"}</h2>
      <p className="mt-1 text-sm text-muted">
        {copy?.scoreTransferDesc ??
          "Export the scores for your score username to a file, or add scores from that file that are missing in lazer. No replays."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className="rx-btn" href="/api/score-transfer/export" download="roxysu-scores.json">
          {copy?.scoreTransferExport ?? "Export scores"}
        </a>
        <button
          type="button"
          className="rx-btn-primary"
          disabled={previewMut.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {copy?.scoreTransferImport ?? "Import scores"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setOpen(true);
            setPreview(null);
            setConfirming(false);
            commitMut.reset();
            previewMut.mutate(file);
          }}
        />
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => {
            if (!busy) setOpen(false);
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
                {previewMut.isPending
                  ? (copy?.scoreTransferReading ?? "Reading the file")
                  : commitMut.data
                    ? (copy?.scoreTransferDone ?? "Added")
                    : confirming
                      ? (copy?.scoreTransferCloseLazer ?? "Close osu!lazer")
                      : (copy?.scoreTransfer ?? "Score transfer")}
              </h2>
            </div>
            <div className="px-5 py-5">
              {previewMut.isPending ? (
                <div className="flex flex-col items-center py-6 text-center">
                  <div className="relative h-16 w-16">
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
                  </div>
                  <p className="mt-5 text-sm font-semibold text-ink">
                    {copy?.scoreTransferReading ?? "Reading the file"}
                  </p>
                </div>
              ) : null}
              {error && !previewMut.isPending ? (
                <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
              ) : null}
              {preview && !previewMut.isPending && !confirming && !commitMut.data ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat value={preview.found} label={copy?.scoreTransferFound ?? "Found"} tone="ink" />
                  <Stat
                    value={preview.already}
                    label={copy?.scoreTransferAlready ?? "Already in lazer"}
                    tone="muted"
                  />
                  <Stat
                    value={addable}
                    label={copy?.scoreTransferCanAdd ?? "Can add"}
                    hint={
                      preview.currentVersion > 0
                        ? `${preview.currentVersion} ${copy?.scoreTransferCurrentVersion ?? "set on an older version of the map"}`
                        : undefined
                    }
                    tone="accent"
                  />
                  <Stat
                    value={preview.skipped}
                    label={copy?.scoreTransferSkipped ?? "Map not installed"}
                    tone="warning"
                  />
                </div>
              ) : null}
              {confirming && !commitMut.data ? (
                <div className="page-enter space-y-2 text-sm">
                  <p className="font-semibold text-ink">
                    {copy?.scoreTransferCloseLazer ?? "Close osu!lazer before continuing."}
                  </p>
                  <p className="text-muted">
                    {copy?.scoreTransferBackup ??
                      "Roxysu copies client.realm first and keeps the last 5 backups. Scores show in-game without a replay."}
                  </p>
                </div>
              ) : null}
              {commitMut.data ? (
                <div className="page-enter space-y-2 text-sm">
                  <p className="text-lg font-bold text-ink">
                    {commitMut.data.added} {copy?.scoreTransferDone ?? "added"}
                  </p>
                  <p className="break-all text-muted">{commitMut.data.backupPath}</p>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/5 px-5 py-4">
              {confirming && !commitMut.data ? (
                <button
                  type="button"
                  className="rx-btn"
                  disabled={commitMut.isPending}
                  onClick={() => setConfirming(false)}
                >
                  {copy?.scoreTransferCancel ?? "Back"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rx-btn"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  {copy?.scoreTransferCancel ?? "Close"}
                </button>
              )}
              {preview && !previewMut.isPending && !confirming && !commitMut.data && addable > 0 ? (
                <button type="button" className="rx-btn-primary" onClick={() => setConfirming(true)}>
                  {copy?.scoreTransferAdd ?? "Add to lazer"} · {addable}
                </button>
              ) : null}
              {confirming && !commitMut.data ? (
                <button
                  type="button"
                  className="rx-btn-primary"
                  disabled={commitMut.isPending}
                  onClick={() => commitMut.mutate()}
                >
                  {commitMut.isPending
                    ? (copy?.scoreTransferWriting ?? "Writing…")
                    : (copy?.scoreTransferConfirm ?? "Lazer is closed — add scores")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
