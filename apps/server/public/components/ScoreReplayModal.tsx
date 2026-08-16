import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { fetchScoreReplay, type ScoreReplay } from "../lib/api";
import { AudioClock, sampleAudioClock } from "../lib/audioClock";
import { clamp, formatAccuracy, formatClock } from "../lib/format";
import { useStdSkin } from "../lib/stdSkin";
import { useTaikoSkin } from "../lib/taikoSkin";
import { useCatchSkin } from "../lib/catchSkin";
import { usePreviewSkin } from "../lib/previewSkin";
import { ModBadges } from "./ModBadges";
import {
  codeToColumn,
  formatKeyCode,
  resolveKeybinds,
  useKeybinds,
} from "../lib/keybinds";
import { LiveManiaPlay, type PracticeRange } from "../lib/liveManiaPlay";
import { maniaHitWindows, type JudgmentSummary } from "../lib/maniaWindows";
import {
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/osuUrls";
import {
  JUDGMENT_COLORS,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
  type NotefieldJudgment,
  type ReplayJudgmentResult,
} from "./ManiaNotefield";
import { StdPlayfield } from "./StdPlayfield";
import { TaikoPlayfield } from "./TaikoPlayfield";
import { CatchPlayfield } from "./CatchPlayfield";
import { NotefieldStage } from "./NotefieldStage";
import {
  buildReplayAnalysis,
  MissSeekMarkers,
  ReplayAnalysisPanel,
} from "./ReplayAnalysisPanel";
import {
  clampRate,
  EMPTY_SUMMARY,
  FIELD_WIDTH_DEFAULT,
  FIELD_WIDTH_MAX,
  FIELD_WIDTH_MIN,
  loadPrefs,
  PRESET_RATES,
  PREFS_KEY,
  SKIP_MS,
  type PreviewPrefs,
} from "./previewPrefs";
import {
  downloadBlob,
  exportReplayVideo,
  type ReplayVideoExportProgress,
} from "../lib/replayVideoExport";
import {
  ReplayVideoExportOptionsModal,
  type ReplayVideoExportChoices,
} from "./ReplayVideoExportOptionsModal";

/** Mania accuracy contribution — Perfect is 305 (matches lazer/stable display). */
const MANIA_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
};
const MANIA_ACC_SCALE = 305;

/** Standard (osu!) accuracy contribution — 300/100/50 on a 300 scale. */
const STD_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 100,
  ok: 50,
  meh: 50,
  miss: 0,
};
const STD_ACC_SCALE = 300;

const TAIKO_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 150,
  ok: 150,
  meh: 0,
  miss: 0,
};

const CATCH_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 100,
  ok: 100,
  meh: 100,
  miss: 0,
};

type ModalMode = "rewatch" | "play";
type LoadedScoreReplay = ScoreReplay & {
  beatmap: NonNullable<ScoreReplay["beatmap"]>;
  playback: NonNullable<ScoreReplay["playback"]>;
  score: NonNullable<ScoreReplay["score"]>;
  frames: NonNullable<ScoreReplay["frames"]>;
  judgments: NonNullable<ScoreReplay["judgments"]>;
  simulated: NonNullable<ScoreReplay["simulated"]>;
  stdFrames?: NonNullable<ScoreReplay["stdFrames"]>;
  taikoFrames?: NonNullable<ScoreReplay["taikoFrames"]>;
  catchFrames?: NonNullable<ScoreReplay["catchFrames"]>;
};

function isLoadedScoreReplay(
  data: Awaited<ReturnType<typeof fetchScoreReplay>> | undefined,
): data is LoadedScoreReplay {
  return Boolean(
    data &&
    !("error" in data) &&
    data.beatmap &&
    data.playback &&
    data.score &&
    data.frames &&
    data.judgments &&
    data.simulated,
  );
}

function playbackRateOptions(current: number): number[] {
  const options: number[] = [...PRESET_RATES];
  if (!options.some((r) => Math.abs(r - current) < 0.001) && current > 0) {
    options.push(clampRate(current));
    options.sort((a, b) => a - b);
  }
  return options;
}

function formatRateLabel(rate: number): string {
  const label = rate.toFixed(2).replace(/\.?0+$/, "");
  return `${label}×`;
}

/**
 * Measures `outerRef`'s box via ResizeObserver and returns the largest
 * `ratio`-shaped rect (in px) that fits inside it, centered. Mirrors the
 * ResizeObserver technique StdPlayfield's own canvas uses internally —
 * more reliable across browsers than CSS `aspect-ratio` on a flex-grow
 * item, whose cross-axis resolution against a flex-basis:0% main size
 * isn't consistently supported.
 */
function useAspectFit(ratio: number) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const fitW = Math.min(w, h * ratio);
      const fitH = fitW / ratio;
      setSize((prev) =>
        prev && Math.abs(prev.width - fitW) < 0.5 && Math.abs(prev.height - fitH) < 0.5
          ? prev
          : { width: fitW, height: fitH },
      );
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  return { outerRef, size };
}

export function ScoreReplayModal({
  scoreId,
  onClose,
}: {
  scoreId: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clockRef = useRef(new AudioClock());
  const audioUrlRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const rateApplied = useRef(false);
  /** Hold UI/clock at this time until media catches up (avoids snap-back to 0). */
  const desiredMsRef = useRef<number | null>(null);
  const seekGuardUntilRef = useRef(0);
  const lengthMsRef = useRef(0);
  const durationMsRef = useRef(0);
  const modeRef = useRef<ModalMode>("rewatch");
  const livePlayRef = useRef<LiveManiaPlay | null>(null);
  const dataRef = useRef<
    Awaited<ReturnType<typeof fetchScoreReplay>> | undefined
  >(undefined);
  /** Map time where the current Play / Test session started (R restarts here). */
  const playStartMsRef = useRef(0);
  const keybindsAll = useKeybinds();
  const bindsRef = useRef<string[]>([]);

  const [prefs, setPrefs] = useState<PreviewPrefs>(() => loadPrefs());
  const prefsRef = useRef(prefs);
  const skin = useStdSkin();
  const taikoSkin = useTaikoSkin();
  const catchSkin = useCatchSkin();
  const previewSkin = usePreviewSkin();
  const [mode, setMode] = useState<ModalMode>("rewatch");
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
  const [liveHeldMask, setLiveHeldMask] = useState(0);
  const [liveJudgments, setLiveJudgments] = useState<NotefieldJudgment[]>([]);
  const [liveSummary, setLiveSummary] =
    useState<JudgmentSummary>(EMPTY_SUMMARY);
  const [exporting, setExporting] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const exportOptionsOpenRef = useRef(false);
  const [exportProgress, setExportProgress] =
    useState<ReplayVideoExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: ["score-replay", scoreId],
    queryFn: () => fetchScoreReplay(scoreId),
  });
  const replayData = isLoadedScoreReplay(data) ? data : null;

  const analysisOn = prefs.analysis;
  const analysis = useMemo(() => {
    if (
      !analysisOn ||
      !replayData ||
      replayData.beatmap.rulesetShortName !== "mania"
    ) {
      return null;
    }
    return buildReplayAnalysis(replayData);
  }, [analysisOn, replayData]);

  const audioUrl = localBeatmapAudioUrl(replayData?.beatmap.audioFileHash);
  const bgUrl =
    localBeatmapCoverUrl(replayData?.beatmap.backgroundFileHash) ??
    osuBeatmapCoverUrl(replayData?.beatmap.setOnlineId, "cover") ??
    null;

  prefsRef.current = prefs;
  audioUrlRef.current = audioUrl;
  onCloseRef.current = onClose;
  modeRef.current = mode;
  exportOptionsOpenRef.current = exportOptionsOpen;
  dataRef.current = data;
  {
    let chartEnd = 0;
    for (const n of replayData?.beatmap.notes ?? []) {
      chartEnd = Math.max(chartEnd, n.endMs, n.startMs);
    }
    for (const o of replayData?.beatmap.hitObjects ?? []) {
      chartEnd = Math.max(
        chartEnd,
        o.type === "circle" ? o.timeMs : o.endMs,
      );
    }
    lengthMsRef.current = Math.max(
      0,
      replayData?.beatmap.lengthMs ?? 0,
      chartEnd,
    );
  }
  durationMsRef.current = durationMs;

  if (replayData && replayData.beatmap.columnCount > 0) {
    bindsRef.current = resolveKeybinds(
      keybindsAll,
      replayData.beatmap.columnCount,
    );
  }

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  // Apply DT/HT default rate once when replay loads.
  useEffect(() => {
    if (!replayData || rateApplied.current) return;
    rateApplied.current = true;
    const modRate = replayData.playback.rate;
    if (modRate !== 1) {
      setPrefs((p) => ({ ...p, rate: clampRate(modRate) }));
    }
  }, [replayData]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = prefs.volume;
    audio.playbackRate = prefs.rate;
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

  function effectivePracticeRange(): PracticeRange | null {
    const start = playStartMsRef.current;
    if (start > 0) {
      return { fromMs: start, toMs: Number.POSITIVE_INFINITY };
    }
    return null;
  }

  function ensureLivePlay(): LiveManiaPlay | null {
    const replay = dataRef.current;
    if (!isLoadedScoreReplay(replay) || replay.beatmap.columnCount <= 0) {
      return null;
    }
    const od = replay.beatmap.overallDifficulty ?? 0;
    const existing = livePlayRef.current;
    if (
      existing &&
      existing.columnCount === replay.beatmap.columnCount &&
      existing.overallDifficulty === od
    ) {
      return existing;
    }
    const play = new LiveManiaPlay({
      notes: replay.beatmap.notes,
      columnCount: replay.beatmap.columnCount,
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

  function enterPlayMode() {
    playStartMsRef.current = 0;
    livePlayRef.current = null;
    setMode("play");
    modeRef.current = "play";
    restartPlay();
  }

  function enterTestFromHere() {
    const replay = dataRef.current;
    if (!isLoadedScoreReplay(replay) || replay.beatmap.columnCount <= 0) return;
    playStartMsRef.current = Math.max(0, mapTimeMs());
    livePlayRef.current = null;
    setMode("play");
    modeRef.current = "play";
    restartPlay();
  }

  function enterRewatchMode() {
    playStartMsRef.current = 0;
    setMode("rewatch");
    modeRef.current = "rewatch";
    livePlayRef.current = null;
    setLiveHeldMask(0);
    setLiveJudgments([]);
    setLiveSummary(EMPTY_SUMMARY);
  }

  function seekTo(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const audioMax =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration * 1000
        : 0;
    const knownMax = Math.max(lengthMsRef.current, durationMsRef.current);
    const max = Math.max(audioMax, knownMax);
    const next = max > 0 ? clamp(ms, 0, max) : Math.max(0, ms);
    desiredMsRef.current = next;
    seekGuardUntilRef.current = performance.now() + 400;
    try {
      audio.currentTime = next / 1000;
    } catch {
      // InvalidStateError before metadata — keep desiredMs until media is ready.
    }
    clockRef.current.set(next, {
      playing: !audio.paused && !audio.ended,
      rate: audio.playbackRate > 0 ? audio.playbackRate : 1,
    });
    setCurrentMs(next);
  }

  function jumpToMiss(tMs: number) {
    // Nudge slightly before the miss so the note is still visible.
    seekTo(Math.max(0, tMs - 400));
    setActiveMissTMs(tMs);
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

  function stopPlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    seekTo(0);
    setPlaying(false);
  }

  function cancelExport() {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    setExporting(false);
    setExportProgress(null);
  }

  function openExportOptions() {
    if (!replayData || exporting || isPlay) return;
    if (
      replayData.beatmap.rulesetShortName !== "mania" &&
      replayData.beatmap.rulesetShortName !== "osu" &&
      replayData.beatmap.rulesetShortName !== "taiko" &&
      replayData.beatmap.rulesetShortName !== "fruits"
    ) {
      setExportError("Export supports mania, standard, taiko, and catch");
      return;
    }
    setExportError(null);
    setExportOptionsOpen(true);
  }

  async function startExport(choices: ReplayVideoExportChoices) {
    if (!replayData || exporting || isPlay) return;
    setExportOptionsOpen(false);
    setExportError(null);
    setExporting(true);
    setExportProgress({ phase: "audio" });
    const ac = new AbortController();
    exportAbortRef.current = ac;
    // Pause live playback so the encoder can use CPU freely.
    audioRef.current?.pause();
    try {
      const result = await exportReplayVideo({
        replay: replayData,
        scrollSpeed: prefsRef.current.scroll,
        fieldWidth: prefsRef.current.fieldWidth,
        fullscreen: prefsRef.current.fullscreen,
        stdSkin: skin,
        taikoSkin,
        catchSkin,
        previewSkin,
        presetId: choices.presetId,
        hideBackground: choices.hideBackground,
        signal: ac.signal,
        onProgress: setExportProgress,
      });
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // cancelled
      } else {
        setExportError(
          err instanceof Error ? err.message : "Failed to export video",
        );
      }
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportProgress(null);
    }
  }

  // Recreate live judge when chart / OD changes.
  useEffect(() => {
    livePlayRef.current = null;
    if (modeRef.current === "play" && replayData) {
      ensureLivePlay()?.reset();
      setLiveHeldMask(0);
      setLiveJudgments([]);
      setLiveSummary(EMPTY_SUMMARY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when chart identity changes
  }, [scoreId, replayData?.beatmap.id, replayData?.beatmap.overallDifficulty]);

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
  }, [mode, scoreId]);

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
        if (exportOptionsOpenRef.current) {
          setExportOptionsOpen(false);
          return;
        }
        if (modeRef.current === "play") {
          enterRewatchMode();
          return;
        }
        onCloseRef.current();
        return;
      }

      // Don't steal keys while the export options dialog is open.
      if (exportOptionsOpenRef.current) return;

      // Space always play/pause in rewatch (even when seek/volume sliders are focused).
      if (modeRef.current !== "play") {
        if (e.key === " " || e.key === "k" || e.key === "K") {
          if (isTextEntry(e.target)) return;
          e.preventDefault();
          togglePlay();
          return;
        }
      }

      if (isTextEntry(e.target)) return;

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
        const replay = dataRef.current;
        if (isLoadedScoreReplay(replay) && replay.beatmap.columnCount > 0) {
          enterPlayMode();
        }
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        enterTestFromHere();
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
  }, []);

  useEffect(() => {
    desiredMsRef.current = null;
    rateApplied.current = false;
    clockRef.current.set(0, { playing: false, rate: prefsRef.current.rate });
    setAudioError(null);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
    setMode("rewatch");
    modeRef.current = "rewatch";
    playStartMsRef.current = 0;
    livePlayRef.current = null;
    setLiveHeldMask(0);
    setLiveJudgments([]);
    setLiveSummary(EMPTY_SUMMARY);
    setHud({ combo: 0, accuracy: 1, last: null });
    setActiveMissTMs(null);
    cancelExport();
    setExportError(null);
    setExportOptionsOpen(false);
  }, [scoreId, audioUrl]);

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const clock = clockRef.current;

    function syncClockFromAudio() {
      const ms = (audio!.currentTime || 0) * 1000;
      const desired = desiredMsRef.current;
      if (desired != null) {
        if (Math.abs(ms - desired) <= 400) {
          desiredMsRef.current = null;
        } else if (performance.now() < seekGuardUntilRef.current) {
          // Media hasn't applied the seek yet (or load handlers raced us).
          clock.set(desired, {
            playing: !audio!.paused && !audio!.ended,
            rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
          });
          setCurrentMs(desired);
          return;
        } else {
          desiredMsRef.current = null;
        }
      }
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
      // Re-apply a pending user seek now that the media is seekable.
      // Do NOT force currentTime=0 — that raced user scrubs back to start.
      const desired = desiredMsRef.current;
      if (desired != null) {
        try {
          audio!.currentTime = desired / 1000;
        } catch {
          // ignore
        }
      }
    }
    function onCanPlay() {
      const desired = desiredMsRef.current;
      if (desired != null) {
        try {
          audio!.currentTime = desired / 1000;
        } catch {
          // ignore
        }
      }
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
  }, [audioUrl]);

  // Live HUD from stored replay judgments (rewatch mode only).
  useEffect(() => {
    if (mode !== "rewatch" || !replayData) return;
    const { judgments } = replayData;
    const ruleset = replayData.beatmap.rulesetShortName;
    const weight =
      ruleset === "osu"
        ? STD_RESULT_WEIGHT
        : ruleset === "taiko"
          ? TAIKO_RESULT_WEIGHT
          : ruleset === "fruits"
            ? CATCH_RESULT_WEIGHT
            : MANIA_RESULT_WEIGHT;
    const scale = ruleset === "mania" ? MANIA_ACC_SCALE : STD_ACC_SCALE;
    let raf = 0;
    let running = true;

    function tick() {
      if (!running) return;
      const t = mapTimeMs();
      let combo = 0;
      let last: ReplayJudgmentResult | null = null;
      let accWeight = 0;
      let judged = 0;
      for (const j of judgments) {
        if (j.tMs > t) break;
        last = j.result;
        // Only miss breaks the combo (50/100/200/300 in mania, 50/100/300 in standard).
        if (j.result === "miss") combo = 0;
        else combo += 1;
        accWeight += weight[j.result];
        judged += 1;
      }
      setHud({
        combo,
        // No notes judged yet → 100%. Then Σ(weight) / (scale × notes played).
        accuracy: judged > 0 ? accWeight / (judged * scale) : 1,
        last,
      });
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mapTimeMs closes over refs
  }, [mode, replayData]);

  function onSeek(e: FormEvent<HTMLInputElement>) {
    if (mode === "play") return;
    seekTo(Number(e.currentTarget.value));
  }

  const title = replayData
    ? [
        replayData.beatmap.title ?? "Untitled",
        replayData.beatmap.difficultyName,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Score rewatch";
  const subtitleParts = replayData
    ? [
        replayData.beatmap.artist,
        replayData.beatmap.rulesetShortName === "osu" ||
        replayData.beatmap.rulesetShortName === "fruits"
          ? `CS ${(replayData.beatmap.circleSize ?? 5).toFixed(1)} · AR ${(replayData.beatmap.approachRate ?? 5).toFixed(1)}`
          : replayData.beatmap.columnCount > 0
            ? `${replayData.beatmap.columnCount}K`
            : null,
        replayData.score.userUsername,
      ].filter(Boolean)
    : [];
  const chartEndMs = (() => {
    let end = 0;
    for (const n of replayData?.beatmap.notes ?? []) {
      end = Math.max(end, n.endMs, n.startMs);
    }
    for (const o of replayData?.beatmap.hitObjects ?? []) {
      if (o.type === "circle") end = Math.max(end, o.timeMs);
      else end = Math.max(end, o.endMs);
    }
    for (const o of replayData?.beatmap.taikoHitObjects ?? []) {
      if (o.type === "hit") end = Math.max(end, o.timeMs);
      else end = Math.max(end, o.endMs);
    }
    for (const o of replayData?.beatmap.catchHitObjects ?? []) {
      end = Math.max(end, o.timeMs);
    }
    return end;
  })();
  const maxDuration = (() => {
    const candidates = [
      durationMs,
      replayData?.beatmap.lengthMs ?? 0,
      chartEndMs,
    ].filter((n) => Number.isFinite(n) && n > 0 && n < 24 * 60 * 60 * 1000);
    const base = candidates.length > 0 ? Math.max(...candidates) : 1;
    return Math.max(base, currentMs, 1);
  })();
  const scrollLabel = Math.round(prefs.scroll);
  const fullscreen = prefs.fullscreen;
  const isPlay = mode === "play";
  const isManiaReplay =
    !!replayData &&
    replayData.beatmap.rulesetShortName === "mania" &&
    replayData.beatmap.columnCount > 0;
  const isStdReplay =
    !!replayData &&
    replayData.beatmap.rulesetShortName === "osu" &&
    (replayData.beatmap.hitObjects?.length ?? 0) > 0;
  const isTaikoReplay =
    !!replayData &&
    replayData.beatmap.rulesetShortName === "taiko" &&
    (replayData.beatmap.taikoHitObjects?.length ?? 0) > 0;
  const isCatchReplay =
    !!replayData &&
    replayData.beatmap.rulesetShortName === "fruits" &&
    (replayData.beatmap.catchHitObjects?.length ?? 0) > 0;
  const isLetterboxReplay = isStdReplay || isCatchReplay;
  const { outerRef: stdFitRef, size: stdFitSize } = useAspectFit(4 / 3);
  const canLivePlay = isManiaReplay;
  const binds = canLivePlay
    ? resolveKeybinds(keybindsAll, replayData!.beatmap.columnCount)
    : [];
  const showAnalysis = analysisOn && !isPlay && isManiaReplay;

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
            : isLetterboxReplay
              ? "relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,64rem)] sm:max-w-[min(96vw,96rem)] sm:rounded-2xl"
              : "relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,58rem)] sm:max-w-6xl sm:rounded-2xl"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {exporting ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 backdrop-blur-sm">
            <p className="font-display text-lg font-bold text-on-media">
              Exporting video…
            </p>
            <p className="text-sm text-on-media-muted">
              {exportProgress?.phase === "audio"
                ? "Decoding audio…"
                : exportProgress?.phase === "finalize"
                  ? "Finalizing MP4…"
                  : exportProgress?.phase === "encode" &&
                      exportProgress.fraction != null
                    ? `Encoding ${Math.round(exportProgress.fraction * 100)}%`
                    : "Preparing…"}
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-accent-glow transition-[width] duration-150"
                style={{
                  width: `${Math.round((exportProgress?.fraction ?? 0) * 100)}%`,
                }}
              />
            </div>
            <button
              type="button"
              onClick={cancelExport}
              className="mt-2 rounded-full px-4 py-1.5 text-sm text-on-media-muted ring-1 ring-white/15 transition hover:bg-white/10 hover:text-on-media"
            >
              Cancel
            </button>
          </div>
        ) : null}

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
              className="truncate font-display text-xl font-bold text-on-media sm:text-2xl"
            >
              {title}
            </h2>
            {subtitleParts.length > 0 || replayData?.score.mods ? (
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-on-media-muted">
                {subtitleParts.length > 0 ? (
                  <span className="truncate">{subtitleParts.join(" · ")}</span>
                ) : null}
                {replayData ? <ModBadges mods={replayData.score.mods} /> : null}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canLivePlay ? (
              <div className="mr-1 flex rounded-full bg-black/40 p-0.5 ring-1 ring-white/10">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    !isPlay
                      ? "bg-accent-glow text-on-media"
                      : "text-on-media-muted hover:text-on-media"
                  }`}
                  onClick={enterRewatchMode}
                >
                  Rewatch
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    isPlay
                      ? "bg-accent-glow text-on-media"
                      : "text-on-media-muted hover:text-on-media"
                  }`}
                  onClick={enterPlayMode}
                  title="Play from start (Enter)"
                >
                  Play
                </button>
              </div>
            ) : null}
            {!isPlay && (isManiaReplay || isStdReplay || isTaikoReplay || isCatchReplay) ? (
              <button
                type="button"
                onClick={openExportOptions}
                disabled={exporting || !replayData}
                className="rounded-full px-3 py-1 text-sm text-on-media-muted transition hover:bg-white/10 hover:text-on-media disabled:opacity-40"
                title="Export playfield + audio as MP4"
              >
                {exporting ? "Exporting…" : "Export"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                setPrefs((p) => ({ ...p, fullscreen: !p.fullscreen }))
              }
              className="rounded-full px-3 py-1 text-sm text-on-media-muted transition hover:bg-white/10 hover:text-on-media"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-pressed={fullscreen}
              title="F"
            >
              {fullscreen ? "Window" : "Full"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (isPlay) {
                  enterRewatchMode();
                  return;
                }
                onClose();
              }}
              className="rounded-full px-3 py-1 text-sm text-on-media-muted transition hover:bg-white/10 hover:text-on-media"
              aria-label={isPlay ? "Back to rewatch" : "Close"}
              title={isPlay ? "Back to rewatch (Esc)" : "Close (Esc)"}
            >
              Esc
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <p className="px-5 py-10 text-center text-sm text-on-media-muted">
              Loading replay…
            </p>
          ) : error ? (
            <p className="px-5 py-10 text-center text-sm text-rose-300">
              {error instanceof Error ? error.message : "Failed to load replay"}
            </p>
          ) : data ? (
            <>
              {isPlay ? (
                <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-white/10 bg-black/40 px-4 py-2 text-sm tabular-nums backdrop-blur">
                  <span className="font-bold text-on-media">
                    {liveSummary.combo}x
                  </span>
                  <span className="text-on-media-muted">
                    {formatAccuracy(liveSummary.accuracy)}
                  </span>
                  <span className="text-on-media-muted">
                    max {liveSummary.maxCombo}x
                  </span>
                  <span className="hidden text-xs text-on-media-muted sm:inline">
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
                ref={isLetterboxReplay ? stdFitRef : undefined}
                className={
                  showAnalysis
                    ? "relative flex min-h-0 flex-1 flex-col sm:flex-row"
                    : `relative flex min-h-0 flex-1 flex-col${isLetterboxReplay ? " items-center justify-center" : ""}`
                }
              >
                <div
                  className={
                    isLetterboxReplay
                      ? "relative mx-auto min-h-0 shrink-0"
                      : fullscreen
                        ? "relative mx-auto min-h-0 w-full flex-1 px-2 py-1 sm:px-4 sm:py-2"
                        : showAnalysis
                          ? "relative mx-auto min-h-0 w-full min-w-0 flex-1 px-3 py-2 sm:px-4 sm:py-3"
                          : "relative mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 py-2 sm:max-w-3xl sm:px-6 sm:py-4"
                  }
                  style={
                    isLetterboxReplay
                      ? stdFitSize
                        ? {
                            width: `${stdFitSize.width}px`,
                            height: `${stdFitSize.height}px`,
                          }
                        : { width: "100%", height: "100%", visibility: "hidden" }
                      : fullscreen
                        ? { maxWidth: `${prefs.fieldWidth}%` }
                        : undefined
                  }
                >
                  {!isPlay ? (
                    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-between gap-3 sm:inset-x-6 sm:top-5">
                      <div className="rounded-lg bg-black/55 px-3 py-2 backdrop-blur">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-on-media-muted">
                          Combo
                        </div>
                        <div className="font-display text-2xl font-bold tabular-nums text-on-media">
                          {hud.combo}
                          <span className="text-base text-on-media-muted">x</span>
                        </div>
                      </div>
                      <div className="rounded-lg bg-black/55 px-3 py-2 text-right backdrop-blur">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-on-media-muted">
                          Accuracy
                        </div>
                        <div className="font-display text-2xl font-bold tabular-nums text-on-media">
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
                  ) : null}

                  {isManiaReplay ? (
                    <NotefieldStage
                      columnCount={replayData.beatmap.columnCount}
                      notes={replayData.beatmap.notes}
                      scrollSpeed={prefs.scroll}
                      playbackRate={prefs.rate}
                      liveHeldMask={isPlay ? liveHeldMask : null}
                      getCurrentTimeMs={mapTimeMs}
                      timingX={prefs.timingX}
                      timingY={prefs.timingY}
                      onMoveTiming={(timingX, timingY) =>
                        setPrefs((p) => ({ ...p, timingX, timingY }))
                      }
                      windows={maniaHitWindows(
                        replayData.beatmap.overallDifficulty ?? 0,
                      )}
                      showTiming={isPlay}
                      judgments={
                        isPlay ? liveJudgments : replayData.judgments
                      }
                      frames={isPlay ? undefined : replayData.frames}
                      highlightMissNotes={showAnalysis}
                    />
                  ) : isStdReplay ? (
                    <div className="relative h-full w-full">
                      <div className="h-full w-full overflow-hidden rounded-xl">
                        <StdPlayfield
                          hitObjects={replayData.beatmap.hitObjects ?? []}
                          circleSize={replayData.beatmap.circleSize ?? 5}
                          approachRate={replayData.beatmap.approachRate ?? 5}
                          frames={replayData.stdFrames ?? []}
                          judgments={replayData.judgments}
                          getCurrentTimeMs={mapTimeMs}
                          hidden={replayData.playback.acronyms.includes("HD")}
                          skin={skin}
                        />
                      </div>
                    </div>
                  ) : isTaikoReplay ? (
                    <div className="relative h-full w-full overflow-hidden rounded-xl">
                      <TaikoPlayfield
                        hitObjects={replayData.beatmap.taikoHitObjects ?? []}
                        frames={replayData.taikoFrames ?? []}
                        judgments={replayData.judgments}
                        getCurrentTimeMs={mapTimeMs}
                        hidden={replayData.playback.acronyms.includes("HD")}
                        skin={taikoSkin}
                      />
                    </div>
                  ) : isCatchReplay ? (
                    <div className="relative h-full w-full">
                      <div className="h-full w-full overflow-hidden rounded-xl">
                        <CatchPlayfield
                          hitObjects={replayData.beatmap.catchHitObjects ?? []}
                          circleSize={replayData.beatmap.circleSize ?? 5}
                          approachRate={replayData.beatmap.approachRate ?? 5}
                          frames={replayData.catchFrames ?? []}
                          judgments={replayData.judgments}
                          getCurrentTimeMs={mapTimeMs}
                          hidden={replayData.playback.acronyms.includes("HD")}
                          skin={catchSkin}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] items-center justify-center rounded-xl bg-black/40 px-6 text-center text-sm text-on-media-muted">
                      Could not load playfield for this score.
                    </div>
                  )}
                </div>

                {showAnalysis && analysis && replayData ? (
                  <div className="h-56 shrink-0 sm:h-auto sm:w-72 sm:max-w-[40%] md:w-80">
                    <ReplayAnalysisPanel
                      data={replayData}
                      analysis={analysis}
                      onJumpToMiss={jumpToMiss}
                      activeMissTMs={activeMissTMs}
                    />
                  </div>
                ) : null}
              </div>

              <div className="group/ctrl absolute inset-x-0 bottom-0 z-20">
                <div
                  className="absolute inset-x-0 bottom-0 h-14"
                  aria-hidden
                />
                {audioUrl ? (
                  <audio ref={audioRef} src={audioUrl} preload="auto" />
                ) : null}
                <div className="pointer-events-none relative translate-y-full border-t border-white/10 bg-black/55 px-4 py-3 opacity-0 backdrop-blur transition duration-200 group-hover/ctrl:pointer-events-auto group-hover/ctrl:translate-y-0 group-hover/ctrl:opacity-100 group-focus-within/ctrl:pointer-events-auto group-focus-within/ctrl:translate-y-0 group-focus-within/ctrl:opacity-100 sm:px-6 sm:py-4">
                  {audioError || !audioUrl ? (
                    <p className="mb-3 text-sm text-amber-200/90">
                      {audioError ??
                        "Audio not available locally — re-sync after updating Roxysu."}
                    </p>
                  ) : null}
                  {exportError ? (
                    <p className="mb-3 text-sm text-rose-300">{exportError}</p>
                  ) : null}

                  {!isPlay ? (
                    replayData ? (
                      <ReplayStatsBar data={replayData} />
                    ) : null
                  ) : null}

                  <div className="relative mb-3 flex items-center gap-3">
                    <span className="w-16 shrink-0 tabular-nums text-xs text-on-media-muted sm:w-20">
                      {formatClock(currentMs)}
                    </span>
                    <div className="relative min-w-0 flex-1">
                      {showAnalysis && analysis ? (
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
                        disabled={!audioUrl || isPlay}
                        className="relative z-[1] min-w-0 w-full accent-[var(--accent)] disabled:opacity-40"
                        aria-label="Seek"
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-xs text-on-media-muted sm:w-20">
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
                          onClick={stopPlayback}
                          title="Stop (S / Home)"
                        >
                          Stop
                        </button>
                        {canLivePlay ? (
                          <button
                            type="button"
                            className="rx-btn-primary"
                            disabled={!audioUrl}
                            onClick={enterTestFromHere}
                            title="Play from here (T)"
                          >
                            Test
                          </button>
                        ) : null}
                      </>
                    )}

                    <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

                    <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-xs text-on-media-muted sm:flex-none">
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

                    <label className="flex items-center gap-2 text-xs text-on-media-muted">
                      <span className="shrink-0">Rate</span>
                      <select
                        className="rx-select py-1.5 text-xs"
                        value={String(prefs.rate)}
                        onChange={(e) =>
                          setPrefs((p) => ({
                            ...p,
                            rate: clampRate(Number(e.target.value)),
                          }))
                        }
                        aria-label="Playback rate"
                      >
                        {playbackRateOptions(prefs.rate).map((r) => (
                          <option key={r} value={r}>
                            {formatRateLabel(r)}
                          </option>
                        ))}
                      </select>
                    </label>

                    {isManiaReplay ? (
                    <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-on-media-muted sm:max-w-xs">
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
                    ) : null}

                    {fullscreen && !isLetterboxReplay ? (
                      <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-on-media-muted sm:max-w-xs">
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

                    {!isPlay && isManiaReplay ? (
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-on-media-muted">
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
                    ) : null}
                  </div>

                  <p className="mt-2 hidden text-[11px] text-on-media-muted sm:block">
                    {isPlay ? (
                      <>
                        Keys {binds.map((c) => formatKeyCode(c)).join(" ")} · R
                        restart · Esc rewatch
                        {" · "}
                        <a
                          href="#/settings"
                          className="text-on-media-muted underline-offset-2 hover:underline"
                        >
                          Edit keybinds
                        </a>
                      </>
                    ) : (
                      <>
                        Enter play · T test here · Space play · ← → skip 5s · S
                        stop · F fullscreen · [ ] scroll
                        {canLivePlay ? " · Esc close" : ""}
                      </>
                    )}
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <ReplayVideoExportOptionsModal
        open={exportOptionsOpen}
        replay={replayData}
        busy={exporting}
        onClose={() => setExportOptionsOpen(false)}
        onConfirm={(choices) => void startExport(choices)}
      />
    </div>
  );
}

function ReplayStatsBar({ data }: { data: LoadedScoreReplay }) {
  const sim = data.simulated;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-media-muted">
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
