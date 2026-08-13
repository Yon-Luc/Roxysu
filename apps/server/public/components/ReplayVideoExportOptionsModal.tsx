import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DISCORD_UPLOAD_LIMIT_BYTES,
  REPLAY_VIDEO_EXPORT_PRESETS,
  estimateReplayDurationMs,
  estimateReplayVideoBytes,
  formatExportByteSize,
  getReplayVideoExportPreset,
  type ReplayVideoExportPresetId,
} from "../lib/replayVideoExport";
import { formatClock } from "../lib/format";

export type ReplayVideoExportChoices = {
  presetId: ReplayVideoExportPresetId;
  hideBackground: boolean;
};

type ReplayVideoExportOptionsModalProps = {
  open: boolean;
  /** Replay payload used for duration / size estimates. */
  replay: Parameters<typeof estimateReplayDurationMs>[0] | null;
  busy?: boolean;
  onConfirm: (choices: ReplayVideoExportChoices) => void;
  onClose: () => void;
};

export function ReplayVideoExportOptionsModal({
  open,
  replay,
  busy = false,
  onConfirm,
  onClose,
}: ReplayVideoExportOptionsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [presetId, setPresetId] =
    useState<ReplayVideoExportPresetId>("discord");
  const [hideBackground, setHideBackground] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPresetId("discord");
    setHideBackground(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      prev?.focus();
    };
  }, [open, busy, onClose]);

  const preset = getReplayVideoExportPreset(presetId);
  const durationMs = useMemo(
    () =>
      replay
        ? estimateReplayDurationMs(replay, {
            trimIdle: preset.trimIdle ?? false,
          })
        : 0,
    [replay, preset.trimIdle],
  );
  const durationSec = Math.max(1, durationMs / 1000);
  const estimateBytes = estimateReplayVideoBytes(
    durationSec,
    preset,
    hideBackground,
  );
  const underDiscordLimit = estimateBytes <= DISCORD_UPLOAD_LIMIT_BYTES;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            Export video
          </h2>
          <p className="mt-1 text-sm text-muted">
            Choose quality before encoding. Size is an estimate.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
              Quality
            </legend>
            <div className="grid gap-2">
              {REPLAY_VIDEO_EXPORT_PRESETS.map((p) => {
                const selected = p.id === presetId;
                const presetDurSec = replay
                  ? Math.max(
                      1,
                      estimateReplayDurationMs(replay, {
                        trimIdle: p.trimIdle ?? false,
                      }) / 1000,
                    )
                  : durationSec;
                const bytes = estimateReplayVideoBytes(
                  presetDurSec,
                  p,
                  selected ? hideBackground : p.hideBackgroundDefault,
                );
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ring-1 transition ${
                      selected
                        ? "bg-accent/15 ring-accent/40"
                        : "bg-black/20 ring-white/10 hover:bg-black/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="export-preset"
                      className="mt-1 accent-[var(--accent)]"
                      checked={selected}
                      disabled={busy}
                      onChange={() => {
                        setPresetId(p.id);
                        setHideBackground(p.hideBackgroundDefault);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-ink">{p.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">
                          ~{formatExportByteSize(bytes)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {p.fps}fps
                        {p.tightCrop ? " · tight crop" : ` · ${p.width}×${p.height}`}
                        {p.hudPlacement === "below" ? " · HUD below" : ""}
                        {p.trimIdle ? " · trimmed" : ""}
                        {p.fitUnderBytes ? " · size-capped" : ""}
                        {" · "}
                        {p.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-white/10">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={hideBackground}
              disabled={busy}
              onChange={(e) => setHideBackground(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-semibold text-ink">
                Hide beatmap background
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Solid dark backdrop instead of the cover art. Compresses much
                better — recommended for Discord.
              </span>
            </span>
          </label>

          <div className="rounded-xl bg-black/30 px-3 py-3 text-sm ring-1 ring-white/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted">Estimated size</span>
              <span className="font-display text-lg font-bold tabular-nums text-ink">
                ~{formatExportByteSize(estimateBytes)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
              <span>{formatClock(durationMs)} clip</span>
              <span>
                {preset.tightCrop
                  ? `≤${preset.width}×${preset.height}`
                  : `${preset.width}×${preset.height}`}{" "}
                @ {preset.fps}fps
              </span>
              {hideBackground ? <span>no background</span> : <span>with cover</span>}
              {preset.trimIdle ? <span>trimmed idle</span> : null}
              {preset.fitUnderBytes ? <span>bitrate capped</span> : null}
            </div>
            {presetId === "discord" || hideBackground ? (
              <p
                className={`mt-2 text-xs ${
                  underDiscordLimit ? "text-emerald-300/90" : "text-amber-200/90"
                }`}
              >
                {underDiscordLimit
                  ? `Likely under Discord’s ~${formatExportByteSize(DISCORD_UPLOAD_LIMIT_BYTES)} free upload limit.`
                  : `May exceed Discord’s ~${formatExportByteSize(DISCORD_UPLOAD_LIMIT_BYTES)} free upload limit — try Compact or a shorter map.`}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/5 px-5 py-4">
          <button
            type="button"
            className="rx-btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rx-btn-primary"
            disabled={busy || !replay}
            onClick={() => onConfirm({ presetId, hideBackground })}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
