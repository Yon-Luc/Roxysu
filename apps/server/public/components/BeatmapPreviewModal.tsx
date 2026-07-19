import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { fetchBeatmapPreview, type BeatmapPreview } from "../lib/api";
import { AudioClock, sampleAudioClock } from "../lib/audioClock";
import {
  formatAccuracy,
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/format";
import {
  codeToColumn,
  formatKeyCode,
  resolveKeybinds,
  useKeybinds,
} from "../lib/keybinds";
import {
  LiveManiaPlay,
  type PracticeRange,
} from "../lib/liveManiaPlay";
import { maniaHitWindows, type JudgmentSummary } from "../lib/maniaWindows";
import {
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  getPreviewSkin,
  setPreviewSkin,
  usePreviewSkin,
} from "../lib/previewSkin";
import {
  ManiaNotefield,
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
  type NotefieldJudgment,
} from "./ManiaNotefield";
import {
  TimingVisualizer,
  TIMING_VIS_X_DEFAULT,
  TIMING_VIS_Y_DEFAULT,
} from "./TimingVisualizer";

const PREFS_KEY = "rx-beatmap-preview";
const SKIP_MS = 5000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
/** Fullscreen playfield width as % of the modal (saved). */
const FIELD_WIDTH_MIN = 40;
const FIELD_WIDTH_MAX = 100;
const FIELD_WIDTH_DEFAULT = 55;

type PreviewPrefs = {
  volume: number;
  rate: number;
  scroll: number;
  fullscreen: boolean;
  /** Fullscreen playfield max-width (% of dialog). */
  fieldWidth: number;
  /** Timing visualizer center X (% of playfield). */
  timingX: number;
  /** Timing visualizer center Y (% of playfield). */
  timingY: number;
  /** Solid black backdrop while in Play mode. */
  blackBg: boolean;
  /** Preserved for ScoreReplayModal; unused here. */
  analysis?: boolean;
};

type ModalMode = "preview" | "play";

const DEFAULT_PREFS: PreviewPrefs = {
  volume: 0.85,
  rate: 1,
  scroll: PREVIEW_SCROLL_DEFAULT,
  fullscreen: false,
  fieldWidth: FIELD_WIDTH_DEFAULT,
  timingX: TIMING_VIS_X_DEFAULT,
  timingY: TIMING_VIS_Y_DEFAULT,
  blackBg: false,
};

const EMPTY_SUMMARY: JudgmentSummary = {
  accuracy: 1,
  combo: 0,
  maxCombo: 0,
  counts: {
    perfect: 0,
    great: 0,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 0,
  },
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
      fieldWidth: clamp(
        typeof parsed.fieldWidth === "number"
          ? parsed.fieldWidth
          : DEFAULT_PREFS.fieldWidth,
        FIELD_WIDTH_MIN,
        FIELD_WIDTH_MAX,
      ),
      timingX: clamp(
        typeof parsed.timingX === "number"
          ? parsed.timingX
          : DEFAULT_PREFS.timingX,
        0,
        100,
      ),
      timingY: clamp(
        typeof parsed.timingY === "number"
          ? parsed.timingY
          : DEFAULT_PREFS.timingY,
        0,
        100,
      ),
      blackBg:
        typeof parsed.blackBg === "boolean"
          ? parsed.blackBg
          : DEFAULT_PREFS.blackBg,
      analysis:
        typeof parsed.analysis === "boolean" ? parsed.analysis : undefined,
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
  /** Open directly in Play mode (e.g. future miss-practice entry). */
  initialMode?: ModalMode;
  practiceRange?: PracticeRange | null;
};

export function BeatmapPreviewButton({
  beatmapId,
  className,
  initialMode = "preview",
  practiceRange = null,
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
              initialMode={initialMode}
              practiceRange={practiceRange}
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
  initialMode = "preview",
  practiceRange = null,
}: {
  beatmapId: string;
  onClose: () => void;
  initialMode?: ModalMode;
  practiceRange?: PracticeRange | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clockRef = useRef(new AudioClock());
  const previewSeekDone = useRef(false);
  const previewTimeRef = useRef<number | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const modeRef = useRef<ModalMode>(initialMode);
  const livePlayRef = useRef<LiveManiaPlay | null>(null);
  const dataRef = useRef<BeatmapPreview | undefined>(undefined);
  const practiceRangeRef = useRef(practiceRange);
  /** Map time where the current Play / Test session started (R restarts here). */
  const playStartMsRef = useRef(practiceRange?.fromMs ?? 0);
  const keybindsAll = useKeybinds();
  const bindsRef = useRef<string[]>([]);
  const skin = usePreviewSkin();

  const [prefs, setPrefs] = useState<PreviewPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [liveHeldMask, setLiveHeldMask] = useState(0);
  const [liveJudgments, setLiveJudgments] = useState<NotefieldJudgment[]>([]);
  const [liveSummary, setLiveSummary] = useState<JudgmentSummary>(EMPTY_SUMMARY);

  const { data, error, isLoading } = useQuery({
    queryKey: ["beatmap-preview", beatmapId],
    queryFn: () => fetchBeatmapPreview(beatmapId) as Promise<BeatmapPreview>,
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
  modeRef.current = mode;
  dataRef.current = data;
  practiceRangeRef.current = practiceRange;

  if (data?.supported && data.columnCount > 0) {
    bindsRef.current = resolveKeybinds(keybindsAll, data.columnCount);
  }

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
    // Keep interpolator continuous across rate changes.
    sampleAudioClock(clockRef.current, audio);
  }, [prefs.volume, prefs.rate, audioUrl]);

  function mapTimeMs(): number {
    return sampleAudioClock(clockRef.current, audioRef.current, currentMs);
  }

  function syncLiveHud() {
    const play = livePlayRef.current;
    if (!play) return;
    setLiveHeldMask(play.heldMask);
    setLiveJudgments([...play.judgments]);
    setLiveSummary(play.summary);
  }

  /** Practice window for live judge: prop range ∩ session start (test-from-here). */
  function effectivePracticeRange(): PracticeRange | null {
    const start = playStartMsRef.current;
    const prop = practiceRangeRef.current;
    if (prop) {
      return {
        fromMs: Math.max(prop.fromMs, start),
        toMs: prop.toMs,
      };
    }
    if (start > 0) {
      return { fromMs: start, toMs: Number.POSITIVE_INFINITY };
    }
    return null;
  }

  function ensureLivePlay(): LiveManiaPlay | null {
    const chart = dataRef.current;
    if (!chart?.supported || chart.columnCount <= 0) return null;
    const od = chart.overallDifficulty ?? 0;
    const existing = livePlayRef.current;
    if (
      existing &&
      existing.columnCount === chart.columnCount &&
      existing.overallDifficulty === od
    ) {
      return existing;
    }
    const play = new LiveManiaPlay({
      notes: chart.notes,
      columnCount: chart.columnCount,
      overallDifficulty: od,
      practiceRange: effectivePracticeRange(),
    });
    livePlayRef.current = play;
    return play;
  }

  function restartPlay() {
    const play = ensureLivePlay();
    play?.reset();
    setLiveHeldMask(0);
    setLiveJudgments([]);
    setLiveSummary(EMPTY_SUMMARY);
    seekTo(playStartMsRef.current);
    const audio = audioRef.current;
    if (audio && audioUrlRef.current) {
      void audio.play().catch(() => {
        setAudioError("Playback blocked — click play again");
      });
    }
  }

  /** Start Play from the map beginning (or practiceRange.fromMs). */
  function enterPlayMode() {
    playStartMsRef.current = practiceRangeRef.current?.fromMs ?? 0;
    livePlayRef.current = null;
    setMode("play");
    modeRef.current = "play";
    restartPlay();
  }

  /** Start Play from the current preview scrub position. */
  function enterTestFromHere() {
    if (!dataRef.current?.supported || dataRef.current.columnCount <= 0) {
      return;
    }
    playStartMsRef.current = Math.max(0, mapTimeMs());
    livePlayRef.current = null;
    setMode("play");
    modeRef.current = "play";
    restartPlay();
  }

  function enterPreviewMode() {
    playStartMsRef.current = practiceRangeRef.current?.fromMs ?? 0;
    setMode("preview");
    modeRef.current = "preview";
    livePlayRef.current = null;
    setLiveHeldMask(0);
    setLiveJudgments([]);
    setLiveSummary(EMPTY_SUMMARY);
  }

  function seekTo(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = (audio.duration || 0) * 1000;
    const next = clamp(ms, 0, max > 0 ? max : ms);
    audio.currentTime = next / 1000;
    clockRef.current.set(next, {
      playing: !audio.paused && !audio.ended,
      rate: audio.playbackRate > 0 ? audio.playbackRate : 1,
    });
    setCurrentMs(next);
  }

  function seekBy(deltaMs: number) {
    seekTo(mapTimeMs() + deltaMs);
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

  // Auto-start when opened directly in Play mode (e.g. future miss practice).
  useEffect(() => {
    if (initialMode !== "play") return;
    if (!data?.supported || data.columnCount <= 0) return;
    enterPlayMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.supported, initialMode]);

  // Recreate live judge when chart / OD / practice window changes.
  useEffect(() => {
    livePlayRef.current = null;
    if (modeRef.current === "play" && data?.supported) {
      ensureLivePlay()?.reset();
      setLiveHeldMask(0);
      setLiveJudgments([]);
      setLiveSummary(EMPTY_SUMMARY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when chart identity changes
  }, [beatmapId, data?.id, data?.overallDifficulty, practiceRange]);

  // Tick live judge while in play mode.
  useEffect(() => {
    if (mode !== "play") return;
    let raf = 0;
    let running = true;
    let lastJudgmentCount = -1;
    let lastHeld = -1;
    let lastCombo = -1;
    function loop() {
      if (!running) return;
      const play = livePlayRef.current ?? ensureLivePlay();
      if (play) {
        play.tick(mapTimeMs());
        const summary = play.summary;
        if (
          play.judgments.length !== lastJudgmentCount ||
          play.heldMask !== lastHeld ||
          summary.combo !== lastCombo
        ) {
          lastJudgmentCount = play.judgments.length;
          lastHeld = play.heldMask;
          lastCombo = summary.combo;
          syncLiveHud();
        }
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data?.id]);

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
        if (prefsRef.current.fullscreen) {
          setPrefs((p) => ({ ...p, fullscreen: false }));
          return;
        }
        onCloseRef.current();
        return;
      }
      if (typing) return;

      if (modeRef.current === "play") {
        if (e.repeat) return;
        const col = codeToColumn(bindsRef.current, e.code);
        if (col >= 0) {
          e.preventDefault();
          const play = livePlayRef.current ?? ensureLivePlay();
          if (play) {
            play.press(col, mapTimeMs());
            syncLiveHud();
          }
          return;
        }
        if (e.key === " " || e.key === "k" || e.key === "K") {
          // Space may be a column bind (handled above); otherwise toggle.
          e.preventDefault();
          togglePlay();
          return;
        }
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          restartPlay();
          return;
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          setPrefs((p) => ({ ...p, fullscreen: !p.fullscreen }));
          return;
        }
        if (e.key === "[" || e.key === "]") {
          e.preventDefault();
          const dir = e.key === "[" ? -1 : 1;
          setPrefs((p) => ({
            ...p,
            scroll: clamp(
              p.scroll + dir,
              PREVIEW_SCROLL_MIN,
              PREVIEW_SCROLL_MAX,
            ),
          }));
        }
        return;
      }

      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setPrefs((p) => ({ ...p, fullscreen: !p.fullscreen }));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (dataRef.current?.supported) enterPlayMode();
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        if (dataRef.current?.supported) enterTestFromHere();
        return;
      }
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

    function onKeyUp(e: KeyboardEvent) {
      if (modeRef.current !== "play") return;
      const col = codeToColumn(bindsRef.current, e.code);
      if (col < 0) return;
      e.preventDefault();
      const play = livePlayRef.current ?? ensureLivePlay();
      if (play) {
        play.release(col, mapTimeMs());
        syncLiveHud();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    previewSeekDone.current = false;
    clockRef.current.set(0, { playing: false, rate: prefsRef.current.rate });
    setAudioError(null);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
  }, [beatmapId, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const clock = clockRef.current;

    function seekPreviewIfNeeded() {
      if (previewSeekDone.current) return;
      if (modeRef.current === "play") {
        const start = playStartMsRef.current;
        audio!.currentTime = start / 1000;
        clock.set(start, {
          playing: !audio!.paused && !audio!.ended,
          rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
        });
        setCurrentMs(start);
      } else if (previewTime != null && previewTime > 0) {
        audio!.currentTime = previewTime / 1000;
        clock.set(previewTime, {
          playing: !audio!.paused && !audio!.ended,
          rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
        });
        setCurrentMs(previewTime);
      }
      previewSeekDone.current = true;
    }

    function syncClockFromAudio() {
      const ms = (audio!.currentTime || 0) * 1000;
      clock.observe(ms, {
        playing: !audio!.paused && !audio!.ended,
        rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
      });
      setCurrentMs(ms);
    }

    function onTimeUpdate() {
      syncClockFromAudio();
    }
    function onSeeking() {
      syncClockFromAudio();
    }
    function onSeeked() {
      syncClockFromAudio();
    }
    function onLoadedMetadata() {
      setDurationMs((audio!.duration || 0) * 1000);
      seekPreviewIfNeeded();
    }
    function onCanPlay() {
      seekPreviewIfNeeded();
    }
    function onPlay() {
      syncClockFromAudio();
      setPlaying(true);
    }
    function onPause() {
      syncClockFromAudio();
      setPlaying(false);
    }
    function onEnded() {
      syncClockFromAudio();
      setPlaying(false);
    }
    function onError() {
      setAudioError("Audio not available locally");
    }

    audio.volume = prefsRef.current.volume;
    audio.playbackRate = prefsRef.current.rate;

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);
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
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [audioUrl, previewTime, practiceRange]);

  function onSeek(e: FormEvent<HTMLInputElement>) {
    if (mode === "play") return;
    const next = Number(e.currentTarget.value);
    seekTo(next);
  }

  const title = data
    ? [data.title ?? "Untitled", data.difficultyName]
        .filter(Boolean)
        .join(" · ")
    : "Beatmap preview";
  const subtitle = data
    ? [
        data.artist,
        data.columnCount > 0 ? `${data.columnCount}K` : null,
        data.supported
          ? `OD ${(data.overallDifficulty ?? 0).toFixed(1)}`
          : null,
      ]
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
  const fullscreen = prefs.fullscreen;
  const binds =
    data?.supported && data.columnCount > 0
      ? resolveKeybinds(keybindsAll, data.columnCount)
      : [];
  const isPlay = mode === "play";
  const solidBlack = isPlay && prefs.blackBg;
  // Full chart on the field so judgment noteIndex stays aligned; practiceRange
  // only limits which notes LiveManiaPlay judges.
  const fieldNotes = data?.notes ?? [];

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
        {solidBlack ? (
          <div
            className="pointer-events-none absolute inset-0 bg-black"
            aria-hidden
          />
        ) : (
          <>
            <div
              className="pointer-events-none absolute inset-0 bg-cover bg-center"
              style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/80 to-black/92"
              aria-hidden
            />
          </>
        )}

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
            {data?.supported ? (
              <div className="mr-1 flex rounded-full bg-black/40 p-0.5 ring-1 ring-white/10">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    !isPlay
                      ? "bg-accent-glow text-ink"
                      : "text-muted hover:text-ink"
                  }`}
                  onClick={enterPreviewMode}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    isPlay
                      ? "bg-accent-glow text-ink"
                      : "text-muted hover:text-ink"
                  }`}
                  onClick={enterPlayMode}
                  title="Play from start (Enter)"
                >
                  Play
                </button>
              </div>
            ) : null}
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
              {isPlay ? (
                <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-white/10 bg-black/40 px-4 py-2 text-sm tabular-nums backdrop-blur">
                  <span className="font-bold text-ink">
                    {liveSummary.combo}x
                  </span>
                  <span className="text-muted">
                    {formatAccuracy(liveSummary.accuracy)}
                  </span>
                  <span className="text-faint">
                    max {liveSummary.maxCombo}x
                  </span>
                  <span className="hidden text-xs text-subtle sm:inline">
                    <span className="text-[#ffe566]">
                      {liveSummary.counts.perfect}
                    </span>
                    {" / "}
                    <span className="text-[#7dd3fc]">
                      {liveSummary.counts.great}
                    </span>
                    {" / "}
                    <span className="text-[#86efac]">
                      {liveSummary.counts.good}
                    </span>
                    {" / "}
                    <span className="text-[#fdba74]">
                      {liveSummary.counts.ok}
                    </span>
                    {" / "}
                    <span className="text-[#f9a8d4]">
                      {liveSummary.counts.meh}
                    </span>
                    {" / "}
                    <span className="text-[#f87171]">
                      {liveSummary.counts.miss}
                    </span>
                  </span>
                </div>
              ) : null}

              <div
                className={
                  fullscreen
                    ? "relative mx-auto min-h-0 w-full flex-1 px-2 py-1 sm:px-4 sm:py-2"
                    : "relative mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 py-2 sm:max-w-3xl sm:px-6 sm:py-4"
                }
                style={
                  fullscreen
                    ? { maxWidth: `${prefs.fieldWidth}%` }
                    : undefined
                }
              >
                {data.supported && data.columnCount > 0 ? (
                  <div className="relative h-full w-full">
                    <div className="h-full w-full overflow-hidden rounded-xl">
                      <ManiaNotefield
                        columnCount={data.columnCount}
                        notes={fieldNotes}
                        scrollSpeed={prefs.scroll}
                        liveHeldMask={isPlay ? liveHeldMask : null}
                        judgments={isPlay ? liveJudgments : undefined}
                        getCurrentTimeMs={mapTimeMs}
                      />
                    </div>
                    {isPlay ? (
                      <TimingVisualizer
                        judgments={liveJudgments}
                        windows={maniaHitWindows(
                          data.overallDifficulty ?? 0,
                        )}
                        xPct={prefs.timingX}
                        yPct={prefs.timingY}
                        onMove={(timingX, timingY) =>
                          setPrefs((p) => ({ ...p, timingX, timingY }))
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[16rem] items-center justify-center rounded-xl bg-black/40 px-6 text-center text-sm text-muted">
                    {data.rulesetShortName === "mania"
                      ? "Could not load mania notes for this map."
                      : "Notefield preview is mania-only. Audio and background still work."}
                  </div>
                )}
              </div>

              <div
                className={
                  isPlay
                    ? "group/ctrl absolute inset-x-0 bottom-0 z-20"
                    : "border-t border-white/10 bg-black/50 px-4 py-3 backdrop-blur sm:px-6 sm:py-4"
                }
              >
                {isPlay ? (
                  <div
                    className="absolute inset-x-0 bottom-0 h-12"
                    aria-hidden
                  />
                ) : null}
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} preload="auto" />
                ) : null}
                <div
                  className={
                    isPlay
                      ? "pointer-events-none relative translate-y-full border-t border-white/10 bg-black/50 px-4 py-3 opacity-0 backdrop-blur transition duration-200 group-hover/ctrl:pointer-events-auto group-hover/ctrl:translate-y-0 group-hover/ctrl:opacity-100 group-focus-within/ctrl:pointer-events-auto group-focus-within/ctrl:translate-y-0 group-focus-within/ctrl:opacity-100 sm:px-6 sm:py-4"
                      : undefined
                  }
                >

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
                    disabled={!audioUrl || isPlay}
                    className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-40"
                    aria-label="Seek"
                  />
                  <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted sm:w-20">
                    {formatClock(maxDuration)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {isPlay ? (
                    <>
                      <button
                        type="button"
                        className="rx-btn-primary min-w-[5.5rem]"
                        onClick={togglePlay}
                        disabled={!audioUrl}
                        title="Play / pause"
                      >
                        {playing ? "Pause" : "Play"}
                      </button>
                      <button
                        type="button"
                        className="rx-btn"
                        disabled={!audioUrl}
                        onClick={restartPlay}
                        title="Restart from session start (R)"
                      >
                        Restart
                      </button>
                    </>
                  ) : (
                    <>
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
                      <button
                        type="button"
                        className="rx-btn-primary"
                        disabled={!audioUrl || !data.supported}
                        onClick={enterTestFromHere}
                        title="Play from here (T)"
                      >
                        Test
                      </button>
                    </>
                  )}

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

                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-muted sm:max-w-xs">
                    <span className="shrink-0">
                      Hit {Math.round(skin.hitPosition * 100)}%
                    </span>
                    <input
                      type="range"
                      min={HIT_POSITION_MIN}
                      max={HIT_POSITION_MAX}
                      step={0.01}
                      value={skin.hitPosition}
                      onInput={(e) => {
                        const hitPosition = Number(e.currentTarget.value);
                        setPreviewSkin({ ...getPreviewSkin(), hitPosition });
                      }}
                      className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                      aria-label="Hit position"
                    />
                  </label>

                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-muted sm:max-w-xs">
                    <span className="shrink-0">
                      Cover {Math.round(skin.laneCover * 100)}%
                    </span>
                    <input
                      type="range"
                      min={LANE_COVER_MIN}
                      max={LANE_COVER_MAX}
                      step={0.01}
                      value={skin.laneCover}
                      onInput={(e) => {
                        const laneCover = Number(e.currentTarget.value);
                        setPreviewSkin({ ...getPreviewSkin(), laneCover });
                      }}
                      className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                      aria-label="Lane cover"
                    />
                  </label>

                  {fullscreen ? (
                    <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-muted sm:max-w-xs">
                      <span className="shrink-0">
                        Size {Math.round(prefs.fieldWidth)}%
                      </span>
                      <input
                        type="range"
                        min={FIELD_WIDTH_MIN}
                        max={FIELD_WIDTH_MAX}
                        step={1}
                        value={prefs.fieldWidth}
                        onInput={(e) => {
                          const fieldWidth = Number(e.currentTarget.value);
                          setPrefs((p) => ({ ...p, fieldWidth }));
                        }}
                        className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                        aria-label="Playfield size"
                      />
                    </label>
                  ) : null}

                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={prefs.blackBg}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          blackBg: e.target.checked,
                        }))
                      }
                      className="accent-[var(--accent)]"
                      aria-label="Black background in Play mode"
                    />
                    <span className="shrink-0">Black bg</span>
                  </label>
                </div>

                <p className="mt-2 hidden text-[11px] text-faint sm:block">
                  {isPlay ? (
                    <>
                      Keys{" "}
                      {binds.map((c) => formatKeyCode(c)).join(" ")} · R restart
                      · Esc close
                      {" · "}
                      <a
                        href="#/settings"
                        className="text-subtle underline-offset-2 hover:underline"
                      >
                        Edit keybinds
                      </a>
                    </>
                  ) : (
                    <>
                      Enter play · T test here · Space play · ← → skip 5s · Home
                      start · P preview · F fullscreen · [ ] scroll · , . rate
                      {" · "}
                      <a
                        href="#/skin"
                        className="text-subtle underline-offset-2 hover:underline"
                      >
                        Edit skin
                      </a>
                    </>
                  )}
                </p>
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
