import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { fetchBeatmapPreview } from "../lib/api";
import {
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/format";
import {
  ManiaNotefield,
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
} from "./ManiaNotefield";

const PREFS_KEY = "rx-beatmap-preview";
const SKIP_MS = 5000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

type PreviewPrefs = {
  volume: number;
  rate: number;
  scroll: number;
};

const DEFAULT_PREFS: PreviewPrefs = {
  volume: 0.85,
  rate: 1,
  scroll: PREVIEW_SCROLL_DEFAULT,
};

function loadPrefs(): PreviewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PreviewPrefs>;
    return {
      volume: clamp(
        typeof parsed.volume === "number" ? parsed.volume : DEFAULT_PREFS.volume,
        0,
        1,
      ),
      rate: RATES.includes(parsed.rate as (typeof RATES)[number])
        ? (parsed.rate as number)
        : DEFAULT_PREFS.rate,
      scroll: migratePreviewScroll(
        typeof parsed.scroll === "number" ? parsed.scroll : DEFAULT_PREFS.scroll,
      ),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

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
      {open
        ? createPortal(
            <BeatmapPreviewModal
              beatmapId={beatmapId}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
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
  const previewTimeRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);

  const [prefs, setPrefs] = useState<PreviewPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
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

  prefsRef.current = prefs;
  previewTimeRef.current = previewTime;
  audioUrlRef.current = audioUrl;
  onCloseRef.current = onClose;

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore quota / private mode
    }
  }, [prefs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = prefs.volume;
    audio.playbackRate = prefs.rate;
  }, [prefs.volume, prefs.rate, audioUrl]);

  function seekTo(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = (audio.duration || 0) * 1000;
    const next = clamp(ms, 0, max > 0 ? max : ms);
    audio.currentTime = next / 1000;
    setCurrentMs(next);
  }

  function seekBy(deltaMs: number) {
    const audio = audioRef.current;
    const base = audio ? (audio.currentTime || 0) * 1000 : 0;
    seekTo(base + deltaMs);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !audioUrlRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setAudioError("Playback blocked — click play again");
      });
    } else {
      audio.pause();
    }
  }

  function cycleRate(dir: -1 | 1) {
    setPrefs((p) => {
      const idx = RATES.indexOf(p.rate as (typeof RATES)[number]);
      const cur = idx >= 0 ? idx : RATES.indexOf(1);
      const next = RATES[clamp(cur + dir, 0, RATES.length - 1)]!;
      return { ...p, rate: next };
    });
  }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (typing) return;

      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        seekBy(-SKIP_MS);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") {
        e.preventDefault();
        seekBy(SKIP_MS);
        return;
      }
      if (e.key === "Home" || e.key === "0") {
        e.preventDefault();
        seekTo(0);
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        const pt = previewTimeRef.current;
        if (pt != null && pt > 0) seekTo(pt);
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        setPrefs((p) => ({
          ...p,
          scroll: Math.max(PREVIEW_SCROLL_MIN, p.scroll - 1),
        }));
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        setPrefs((p) => ({
          ...p,
          scroll: Math.min(PREVIEW_SCROLL_MAX, p.scroll + 1),
        }));
        return;
      }
      if (e.key === "," || e.key === "<") {
        e.preventDefault();
        cycleRate(-1);
        return;
      }
      if (e.key === "." || e.key === ">") {
        e.preventDefault();
        cycleRate(1);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, []);

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

    audio.volume = prefsRef.current.volume;
    audio.playbackRate = prefsRef.current.rate;

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

  function onSeek(e: FormEvent<HTMLInputElement>) {
    const next = Number(e.currentTarget.value);
    seekTo(next);
  }

  const title = data
    ? [data.title ?? "Untitled", data.difficultyName]
        .filter(Boolean)
        .join(" · ")
    : "Beatmap preview";
  const subtitle = data
    ? [data.artist, data.columnCount > 0 ? `${data.columnCount}K` : null]
        .filter(Boolean)
        .join(" · ")
    : null;
  const maxDuration = (() => {
    const candidates = [durationMs, data?.lengthMs ?? 0].filter(
      (n) => Number.isFinite(n) && n > 0 && n < 24 * 60 * 60 * 1000,
    );
    const base = candidates.length > 0 ? Math.max(...candidates) : 1;
    return Math.max(base, currentMs, 1);
  })();
  const scrollLabel = Math.round(prefs.scroll);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 p-0 sm:items-center sm:p-3 md:p-5"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,58rem)] sm:max-w-6xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/80 to-black/92"
          aria-hidden
        />

        <div className="relative flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate font-display text-xl font-bold text-ink sm:text-2xl"
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
              <div className="relative mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 py-2 sm:max-w-3xl sm:px-6 sm:py-4">
                {data.supported && data.columnCount > 0 ? (
                  <div className="h-full w-full overflow-hidden rounded-xl">
                    <ManiaNotefield
                      columnCount={data.columnCount}
                      notes={data.notes}
                      scrollSpeed={prefs.scroll}
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
                  <div className="flex h-full min-h-[16rem] items-center justify-center rounded-xl bg-black/40 px-6 text-center text-sm text-muted">
                    {data.rulesetShortName === "mania"
                      ? "Could not load mania notes for this map."
                      : "Notefield preview is mania-only. Audio and background still work."}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} preload="auto" />
                ) : null}

                {audioError || !audioUrl ? (
                  <p className="mb-3 text-sm text-amber-200/90">
                    {audioError ??
                      "Audio not available locally — re-sync after updating Roxysu to resolve audio hashes."}
                  </p>
                ) : null}

                <div className="mb-3 flex items-center gap-3">
                  <span className="w-16 shrink-0 tabular-nums text-xs text-muted sm:w-20">
                    {formatClock(currentMs)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, Math.floor(maxDuration))}
                    step={10}
                    value={Math.min(currentMs, maxDuration)}
                    onInput={onSeek}
                    disabled={!audioUrl}
                    className="min-w-0 flex-1 accent-[var(--accent)]"
                    aria-label="Seek"
                  />
                  <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted sm:w-20">
                    {formatClock(maxDuration)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={!audioUrl}
                    onClick={() => seekBy(-SKIP_MS)}
                    title="Skip back 5s (←)"
                  >
                    −5s
                  </button>
                  <button
                    type="button"
                    className="rx-btn-primary min-w-[5.5rem]"
                    onClick={togglePlay}
                    disabled={!audioUrl}
                    title="Play / pause (Space)"
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={!audioUrl}
                    onClick={() => seekBy(SKIP_MS)}
                    title="Skip forward 5s (→)"
                  >
                    +5s
                  </button>
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={!audioUrl}
                    onClick={() => seekTo(0)}
                    title="Restart (Home)"
                  >
                    Start
                  </button>
                  {previewTime != null && previewTime > 0 ? (
                    <button
                      type="button"
                      className="rx-btn"
                      disabled={!audioUrl}
                      onClick={() => seekTo(previewTime)}
                      title="Jump to preview point (P)"
                    >
                      Preview
                    </button>
                  ) : null}

                  <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

                  <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-muted sm:flex-none">
                    <span className="shrink-0">Vol</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={prefs.volume}
                      onInput={(e) => {
                        const volume = Number(e.currentTarget.value);
                        setPrefs((p) => ({ ...p, volume }));
                      }}
                      className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                      aria-label="Volume"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span className="shrink-0">Rate</span>
                    <select
                      className="rx-select py-1.5 text-xs"
                      value={String(prefs.rate)}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          rate: Number(e.target.value),
                        }))
                      }
                      aria-label="Playback rate"
                    >
                      {RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-muted sm:max-w-xs">
                    <span className="shrink-0">Scroll {scrollLabel}</span>
                    <input
                      type="range"
                      min={PREVIEW_SCROLL_MIN}
                      max={PREVIEW_SCROLL_MAX}
                      step={1}
                      value={prefs.scroll}
                      onInput={(e) => {
                        const scroll = Number(e.currentTarget.value);
                        setPrefs((p) => ({ ...p, scroll }));
                      }}
                      className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                      aria-label="Scroll speed"
                    />
                  </label>
                </div>

                <p className="mt-2 hidden text-[11px] text-faint sm:block">
                  Space play · ← → skip 5s · Home start · P preview · [ ] scroll ·
                  , . rate
                  {" · "}
                  <a href="#/skin" className="text-subtle underline-offset-2 hover:underline">
                    Edit skin
                  </a>
                </p>
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
