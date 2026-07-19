import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { fetchBeatmapPreview } from "../lib/api";
import {
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/format";
import { ManiaNotefield } from "./ManiaNotefield";

type BeatmapPreviewButtonProps = {
  beatmapId: string;
  className?: string;
};

export function BeatmapPreviewButton({
  beatmapId,
  className,
}: BeatmapPreviewButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? "rx-btn"}
      >
        Preview
      </button>
      {open ? (
        <BeatmapPreviewModal
          beatmapId={beatmapId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function BeatmapPreviewModal({
  beatmapId,
  onClose,
}: {
  beatmapId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewSeekDone = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["beatmap-preview", beatmapId],
    queryFn: () => fetchBeatmapPreview(beatmapId),
  });

  const audioUrl = localBeatmapAudioUrl(data?.audioFileHash);
  const bgUrl =
    localBeatmapCoverUrl(data?.backgroundFileHash) ??
    osuBeatmapCoverUrl(data?.setOnlineId, "cover") ??
    null;
  const previewTime = data?.previewTime ?? null;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    previewSeekDone.current = false;
    setAudioError(null);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
  }, [beatmapId, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    function seekPreviewIfNeeded() {
      if (previewSeekDone.current) return;
      if (previewTime != null && previewTime > 0) {
        audio!.currentTime = previewTime / 1000;
        setCurrentMs(previewTime);
      }
      previewSeekDone.current = true;
    }

    function onTimeUpdate() {
      setCurrentMs((audio!.currentTime || 0) * 1000);
    }
    function onLoadedMetadata() {
      setDurationMs((audio!.duration || 0) * 1000);
      seekPreviewIfNeeded();
    }
    function onCanPlay() {
      seekPreviewIfNeeded();
    }
    function onPlay() {
      setPlaying(true);
    }
    function onPause() {
      setPlaying(false);
    }
    function onEnded() {
      setPlaying(false);
    }
    function onError() {
      setAudioError("Audio not available locally");
    }

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    if (audio.readyState >= 1) {
      setDurationMs((audio.duration || 0) * 1000);
      seekPreviewIfNeeded();
    }

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [audioUrl, previewTime]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setAudioError("Playback blocked — click play again");
      });
    } else {
      audio.pause();
    }
  }

  function onSeek(e: FormEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(e.currentTarget.value);
    audio.currentTime = next / 1000;
    setCurrentMs(next);
  }

  const title = data
    ? [data.title ?? "Untitled", data.difficultyName]
        .filter(Boolean)
        .join(" · ")
    : "Beatmap preview";
  const subtitle = data?.artist ?? null;
  const maxDuration = Math.max(
    durationMs,
    data?.lengthMs ?? 0,
    currentMs,
    1,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[min(94vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-canvas shadow-2xl shadow-black/70 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-black/80 to-black/90"
          aria-hidden
        />

        <div className="relative flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate font-display text-xl font-bold text-ink"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Loading preview…
            </p>
          ) : error ? (
            <p className="px-5 py-10 text-center text-sm text-rose-300">
              {error instanceof Error
                ? error.message
                : "Failed to load preview"}
            </p>
          ) : data ? (
            <>
              <div className="relative mx-auto h-[min(55vh,28rem)] w-full max-w-md flex-1 px-4 py-3">
                {data.supported && data.columnCount > 0 ? (
                  <div className="h-full w-full overflow-hidden rounded-xl">
                    <ManiaNotefield
                      columnCount={data.columnCount}
                      notes={data.notes}
                      getCurrentTimeMs={() => {
                        const audio = audioRef.current;
                        if (audio && Number.isFinite(audio.currentTime)) {
                          return audio.currentTime * 1000;
                        }
                        return currentMs;
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl bg-black/40 px-6 text-center text-sm text-muted">
                    {data.rulesetShortName === "mania"
                      ? "Could not load mania notes for this map."
                      : "Notefield preview is mania-only. Audio and background still work."}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-black/40 px-5 py-4 backdrop-blur">
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} preload="auto" />
                ) : null}

                {audioError || !audioUrl ? (
                  <p className="mb-3 text-sm text-amber-200/90">
                    {audioError ??
                      "Audio not available locally — re-sync after updating Roxysu to resolve audio hashes."}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rx-btn-primary min-w-[5.5rem]"
                    onClick={togglePlay}
                    disabled={!audioUrl}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <span className="tabular-nums text-xs text-muted">
                    {formatClock(currentMs)} / {formatClock(maxDuration)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, Math.floor(maxDuration))}
                    step={10}
                    value={Math.min(currentMs, maxDuration)}
                    onInput={onSeek}
                    disabled={!audioUrl}
                    className="min-w-[8rem] flex-1 accent-[var(--accent)]"
                    aria-label="Seek"
                  />
                  {previewTime != null && previewTime > 0 ? (
                    <button
                      type="button"
                      className="rx-btn"
                      disabled={!audioUrl}
                      onClick={() => {
                        const audio = audioRef.current;
                        if (!audio) return;
                        audio.currentTime = previewTime / 1000;
                        setCurrentMs(previewTime);
                      }}
                    >
                      Preview point
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
