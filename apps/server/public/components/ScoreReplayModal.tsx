import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { fetchScoreReplay, type ScoreReplay } from "../lib/api";
import {
  formatAccuracy,
  formatMods,
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/format";
import {
  JUDGMENT_COLORS,
  ManiaNotefield,
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
  type ReplayJudgmentResult,
} from "./ManiaNotefield";
import {
  buildReplayAnalysis,
  MissSeekMarkers,
  ReplayAnalysisPanel,
} from "./ReplayAnalysisPanel";

const PREFS_KEY = "rx-beatmap-preview";
const SKIP_MS = 5000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

/** Mania accuracy contribution — Perfect is 305 (matches lazer/stable display). */
const RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
};
const ACC_SCALE = 305;

type PreviewPrefs = {
  volume: number;
  rate: number;
  scroll: number;
  fullscreen: boolean;
  /** Opt-in miss/timing/pattern tools. Default off. */
  analysis: boolean;
};

const DEFAULT_PREFS: PreviewPrefs = {
  volume: 0.85,
  rate: 1,
  scroll: PREVIEW_SCROLL_DEFAULT,
  fullscreen: false,
  analysis: false,
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
      fullscreen:
        typeof parsed.fullscreen === "boolean"
          ? parsed.fullscreen
          : DEFAULT_PREFS.fullscreen,
      analysis:
        typeof parsed.analysis === "boolean"
          ? parsed.analysis
          : DEFAULT_PREFS.analysis,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function nearestRate(rate: number): number {
  let best = RATES[0]!;
  let bestDist = Math.abs(rate - best);
  for (const r of RATES) {
    const d = Math.abs(rate - r);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

type ScoreReplayButtonProps = {
  scoreId: string;
  /** When false, button is hidden. */
  enabled?: boolean;
  className?: string;
  label?: string;
};

export function ScoreReplayButton({
  scoreId,
  enabled = true,
  className,
  label = "Rewatch",
}: ScoreReplayButtonProps) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

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
        {label}
      </button>
      {open
        ? createPortal(
            <ScoreReplayModal
              scoreId={scoreId}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ScoreReplayModal({
  scoreId,
  onClose,
}: {
  scoreId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const startSeekDone = useRef(false);
  const audioUrlRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const rateApplied = useRef(false);

  const [prefs, setPrefs] = useState<PreviewPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [hud, setHud] = useState({
    combo: 0,
    accuracy: 1,
    last: null as ReplayJudgmentResult | null,
  });
  const [activeMissTMs, setActiveMissTMs] = useState<number | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["score-replay", scoreId],
    queryFn: () => fetchScoreReplay(scoreId),
  });

  const analysisOn = prefs.analysis;
  const analysis = useMemo(() => {
    if (!analysisOn || !data || data.error) return null;
    return buildReplayAnalysis(data as ScoreReplay);
  }, [analysisOn, data]);

  const audioUrl = localBeatmapAudioUrl(data?.beatmap.audioFileHash);
  const bgUrl =
    localBeatmapCoverUrl(data?.beatmap.backgroundFileHash) ??
    osuBeatmapCoverUrl(data?.beatmap.setOnlineId, "cover") ??
    null;

  prefsRef.current = prefs;
  audioUrlRef.current = audioUrl;
  onCloseRef.current = onClose;

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  // Apply DT/HT default rate once when replay loads.
  useEffect(() => {
    if (!data || rateApplied.current) return;
    rateApplied.current = true;
    const modRate = data.playback.rate;
    if (modRate !== 1) {
      setPrefs((p) => ({ ...p, rate: nearestRate(modRate) }));
    }
  }, [data]);

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

  function jumpToMiss(tMs: number) {
    // Nudge slightly before the miss so the note is still visible.
    seekTo(Math.max(0, tMs - 400));
    setActiveMissTMs(tMs);
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

  function stopPlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    seekTo(0);
    setPlaying(false);
  }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function isTextEntry(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type;
        return (
          type === "text" ||
          type === "search" ||
          type === "email" ||
          type === "password" ||
          type === "number" ||
          type === ""
        );
      }
      return el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (prefsRef.current.fullscreen) {
          setPrefs((p) => ({ ...p, fullscreen: false }));
          return;
        }
        onCloseRef.current();
        return;
      }

      // Space always play/pause (even when seek/volume sliders are focused).
      if (e.key === " " || e.key === "k" || e.key === "K") {
        if (isTextEntry(e.target)) return;
        e.preventDefault();
        togglePlay();
        return;
      }

      if (isTextEntry(e.target)) return;

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setPrefs((p) => ({ ...p, fullscreen: !p.fullscreen }));
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        stopPlayback();
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
        stopPlayback();
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
    startSeekDone.current = false;
    rateApplied.current = false;
    setAudioError(null);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
    setHud({ combo: 0, accuracy: 1, last: null });
    setActiveMissTMs(null);
  }, [scoreId, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    function onTimeUpdate() {
      setCurrentMs((audio!.currentTime || 0) * 1000);
    }
    function onLoadedMetadata() {
      setDurationMs((audio!.duration || 0) * 1000);
      if (!startSeekDone.current) {
        audio!.currentTime = 0;
        startSeekDone.current = true;
      }
    }
    function onCanPlay() {
      if (!startSeekDone.current) {
        audio!.currentTime = 0;
        startSeekDone.current = true;
      }
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
  }, [audioUrl]);

  // Live HUD: mania acc starts at 100% and is reweighted over notes judged so far.
  useEffect(() => {
    if (!data) return;
    const judgments = data.judgments;
    let raf = 0;
    let running = true;

    function tick() {
      if (!running) return;
      const audio = audioRef.current;
      const t = audio ? audio.currentTime * 1000 : 0;
      let combo = 0;
      let last: ReplayJudgmentResult | null = null;
      let weight = 0;
      let judged = 0;
      for (const j of judgments) {
        if (j.tMs > t) break;
        last = j.result;
        // Mania: only miss breaks combo (50/100/200/300 all continue it).
        if (j.result === "miss") combo = 0;
        else combo += 1;
        weight += RESULT_WEIGHT[j.result];
        judged += 1;
      }
      setHud({
        combo,
        // No notes judged yet → 100%. Then Σ(weight) / (305 × notes played).
        accuracy: judged > 0 ? weight / (judged * ACC_SCALE) : 1,
        last,
      });
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [data]);

  function onSeek(e: FormEvent<HTMLInputElement>) {
    seekTo(Number(e.currentTarget.value));
  }

  const title = data
    ? [data.beatmap.title ?? "Untitled", data.beatmap.difficultyName]
        .filter(Boolean)
        .join(" · ")
    : "Score rewatch";
  const subtitle = data
    ? [
        data.beatmap.artist,
        data.beatmap.columnCount > 0 ? `${data.beatmap.columnCount}K` : null,
        formatMods(data.score.mods),
        data.score.userUsername,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const maxDuration = (() => {
    const candidates = [
      durationMs,
      data?.beatmap.lengthMs ?? 0,
    ].filter((n) => Number.isFinite(n) && n > 0 && n < 24 * 60 * 60 * 1000);
    const base = candidates.length > 0 ? Math.max(...candidates) : 1;
    return Math.max(base, currentMs, 1);
  })();
  const scrollLabel = Math.round(prefs.scroll);
  const fullscreen = prefs.fullscreen;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex items-stretch justify-center bg-black/90 p-0"
          : "fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 p-0 sm:items-center sm:p-3 md:p-5"
      }
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          fullscreen
            ? "relative flex h-full w-full max-h-none max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none"
            : "relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,58rem)] sm:max-w-6xl sm:rounded-2xl"
        }
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setPrefs((p) => ({ ...p, fullscreen: !p.fullscreen }))
              }
              className="rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-pressed={fullscreen}
              title="F"
            >
              {fullscreen ? "Window" : "Full"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (prefs.fullscreen) {
                  setPrefs((p) => ({ ...p, fullscreen: false }));
                  return;
                }
                onClose();
              }}
              className="rounded-full px-3 py-1 text-sm text-muted transition hover:bg-highlight hover:text-ink"
              aria-label={fullscreen ? "Exit fullscreen" : "Close"}
            >
              Esc
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Loading replay…
            </p>
          ) : error ? (
            <p className="px-5 py-10 text-center text-sm text-rose-300">
              {error instanceof Error
                ? error.message
                : "Failed to load replay"}
            </p>
          ) : data ? (
            <>
              <div
                className={
                  analysisOn
                    ? "relative flex min-h-0 flex-1 flex-col sm:flex-row"
                    : "relative flex min-h-0 flex-1 flex-col"
                }
              >
                <div
                  className={
                    fullscreen
                      ? "relative mx-auto min-h-0 w-full max-w-4xl flex-1 px-2 py-1 sm:max-w-5xl sm:px-4 sm:py-2"
                      : analysisOn
                        ? "relative mx-auto min-h-0 w-full min-w-0 flex-1 px-3 py-2 sm:px-4 sm:py-3"
                        : "relative mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 py-2 sm:max-w-3xl sm:px-6 sm:py-4"
                  }
                >
                  <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-between gap-3 sm:inset-x-6 sm:top-5">
                    <div className="rounded-lg bg-black/55 px-3 py-2 backdrop-blur">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Combo
                      </div>
                      <div className="font-display text-2xl font-bold tabular-nums text-ink">
                        {hud.combo}
                        <span className="text-base text-muted">x</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-black/55 px-3 py-2 text-right backdrop-blur">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                        Accuracy
                      </div>
                      <div className="font-display text-2xl font-bold tabular-nums text-ink">
                        {formatAccuracy(hud.accuracy)}
                      </div>
                      {hud.last ? (
                        <div
                          className="mt-0.5 text-xs font-bold uppercase tracking-wide"
                          style={{ color: JUDGMENT_COLORS[hud.last] }}
                        >
                          {hud.last}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {data.beatmap.columnCount > 0 ? (
                    <div className="h-full w-full overflow-hidden rounded-xl">
                      <ManiaNotefield
                        columnCount={data.beatmap.columnCount}
                        notes={data.beatmap.notes}
                        frames={data.frames}
                        judgments={data.judgments}
                        highlightMissNotes={analysisOn}
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
                      Could not load mania notes for this score.
                    </div>
                  )}
                </div>

                {analysisOn && analysis ? (
                  <div className="h-56 shrink-0 sm:h-auto sm:w-72 sm:max-w-[40%] md:w-80">
                    <ReplayAnalysisPanel
                      data={data as ScoreReplay}
                      analysis={analysis}
                      onJumpToMiss={jumpToMiss}
                      activeMissTMs={activeMissTMs}
                    />
                  </div>
                ) : null}
              </div>

              <div className="border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} preload="auto" />
                ) : null}

                {audioError || !audioUrl ? (
                  <p className="mb-3 text-sm text-amber-200/90">
                    {audioError ??
                      "Audio not available locally — re-sync after updating Roxysu."}
                  </p>
                ) : null}

                <ReplayStatsBar data={data as ScoreReplay} />

                <div className="relative mb-3 flex items-center gap-3">
                  <span className="w-16 shrink-0 tabular-nums text-xs text-muted sm:w-20">
                    {formatClock(currentMs)}
                  </span>
                  <div className="relative min-w-0 flex-1">
                    {analysisOn && analysis ? (
                      <MissSeekMarkers
                        misses={analysis.misses}
                        maxDuration={maxDuration}
                        onJump={jumpToMiss}
                      />
                    ) : null}
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.floor(maxDuration))}
                      step={10}
                      value={Math.min(currentMs, maxDuration)}
                      onInput={onSeek}
                      disabled={!audioUrl}
                      className="relative z-[1] min-w-0 w-full accent-[var(--accent)]"
                      aria-label="Seek"
                    />
                  </div>
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
                  >
                    −5s
                  </button>
                  <button
                    type="button"
                    className="rx-btn-primary min-w-[5.5rem]"
                    onClick={togglePlay}
                    disabled={!audioUrl}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={!audioUrl}
                    onClick={() => seekBy(SKIP_MS)}
                  >
                    +5s
                  </button>
                  <button
                    type="button"
                    className="rx-btn"
                    disabled={!audioUrl}
                    onClick={stopPlayback}
                  >
                    Stop
                  </button>

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

                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={prefs.analysis}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          analysis: e.target.checked,
                        }))
                      }
                      className="accent-[var(--accent)]"
                      aria-label="Analysis mode"
                    />
                    <span className="shrink-0">Analysis</span>
                  </label>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReplayStatsBar({ data }: { data: ScoreReplay }) {
  const sim = data.simulated;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span>
        Stored {formatAccuracy(data.score.accuracy)} · {data.score.maxCombo}x
      </span>
      <span>
        Sim {formatAccuracy(sim.accuracy)} · {sim.maxCombo}x
      </span>
      <span className="tabular-nums">
        <span style={{ color: JUDGMENT_COLORS.perfect }}>
          {sim.counts.perfect}
        </span>
        {" / "}
        <span style={{ color: JUDGMENT_COLORS.great }}>{sim.counts.great}</span>
        {" / "}
        <span style={{ color: JUDGMENT_COLORS.good }}>{sim.counts.good}</span>
        {" / "}
        <span style={{ color: JUDGMENT_COLORS.ok }}>{sim.counts.ok}</span>
        {" / "}
        <span style={{ color: JUDGMENT_COLORS.meh }}>{sim.counts.meh}</span>
        {" / "}
        <span style={{ color: JUDGMENT_COLORS.miss }}>{sim.counts.miss}</span>
      </span>
    </div>
  );
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
