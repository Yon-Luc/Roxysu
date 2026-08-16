import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { fetchBeatmapPreview, type BeatmapPreview } from "../lib/api";
import { AudioClock, sampleAudioClock } from "../lib/audioClock";
import { clamp, formatAccuracy, formatClock } from "../lib/format";
import { useStdSkin } from "../lib/stdSkin";
import { useTaikoSkin } from "../lib/taikoSkin";
import { useCatchSkin } from "../lib/catchSkin";
import {
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "../lib/osuUrls";
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
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
  type NotefieldJudgment,
} from "./ManiaNotefield";
import { StdPlayfield } from "./StdPlayfield";
import { TaikoPlayfield } from "./TaikoPlayfield";
import { CatchPlayfield } from "./CatchPlayfield";
import { ManiaSkinDropHost } from "./ManiaSkinDropHost";
import { NotefieldStage } from "./NotefieldStage";
import {
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

export type ModalMode = "preview" | "play";

export function BeatmapPreviewModal({
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioMountGen, setAudioMountGen] = useState(0);
  const bindAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    if (el) setAudioMountGen((n) => n + 1);
  }, []);
  const clockRef = useRef(new AudioClock());
  const previewSeekDone = useRef(false);
  const previewTimeRef = useRef<number | null>(null);
  /** Hold UI/clock at this time until media catches up (avoids snap-back to 0). */
  const desiredMsRef = useRef<number | null>(null);
  const seekGuardUntilRef = useRef(0);
  const lengthMsRef = useRef(0);
  const durationMsRef = useRef(0);
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
  const stdSkin = useStdSkin();
  const taikoSkin = useTaikoSkin();
  const catchSkin = useCatchSkin();

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
    // Fresh chart/audio hashes after sync; avoid stale cached preview without audio.
    staleTime: 5 * 60_000,
    refetchOnMount: true,
  });

  const audioUrl = localBeatmapAudioUrl(data?.audioFileHash);
  const bgUrl =
    localBeatmapCoverUrl(data?.backgroundFileHash) ??
    osuBeatmapCoverUrl(data?.setOnlineId, "cover") ??
    null;
  // osu PreviewTime is -1 when unset; treat 0/-1/null as "no preview point".
  const previewTime =
    data?.previewTime != null && data.previewTime > 0 ? data.previewTime : null;

  prefsRef.current = prefs;
  previewTimeRef.current = previewTime;
  {
    let chartEnd = 0;
    for (const n of data?.notes ?? []) {
      chartEnd = Math.max(chartEnd, n.endMs, n.startMs);
    }
    for (const o of data?.hitObjects ?? []) {
      chartEnd = Math.max(
        chartEnd,
        o.type === "circle" ? o.timeMs : o.endMs,
      );
    }
    lengthMsRef.current = Math.max(0, data?.lengthMs ?? 0, chartEnd);
  }
  durationMsRef.current = durationMs;
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
      const idx = PRESET_RATES.indexOf(p.rate as (typeof PRESET_RATES)[number]);
      const cur = idx >= 0 ? idx : PRESET_RATES.indexOf(1);
      const next = PRESET_RATES[clamp(cur + dir, 0, PRESET_RATES.length - 1)]!;
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
        if (modeRef.current === "play") {
          enterPreviewMode();
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
        if (
          dataRef.current?.supported &&
          dataRef.current.rulesetShortName === "mania" &&
          (dataRef.current.columnCount ?? 0) > 0
        ) {
          enterPlayMode();
        }
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        if (
          dataRef.current?.supported &&
          dataRef.current.rulesetShortName === "mania" &&
          (dataRef.current.columnCount ?? 0) > 0
        ) {
          enterTestFromHere();
        }
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
    desiredMsRef.current = null;
    clockRef.current.set(0, { playing: false, rate: prefsRef.current.rate });
    audioRef.current?.pause();
    setAudioError(null);
    setCurrentMs(0);
    setDurationMs(0);
    setPlaying(false);
  }, [beatmapId, audioUrl]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const clock = clockRef.current;
    // Do not reset previewSeekDone here — that re-jumps to the preview
    // point whenever listeners are re-bound (audioMountGen / canplay).
    // Track changes already clear it in the effect above.

    function seekPreviewIfNeeded() {
      if (previewSeekDone.current) return;
      previewSeekDone.current = true;
      if (modeRef.current === "play") {
        const start = playStartMsRef.current;
        desiredMsRef.current = start;
        seekGuardUntilRef.current = performance.now() + 400;
        try {
          audio!.currentTime = start / 1000;
        } catch {
          // ignore
        }
        clock.set(start, {
          playing: !audio!.paused && !audio!.ended,
          rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
        });
        setCurrentMs(start);
        return;
      }
      const pt = previewTimeRef.current;
      if (pt == null || pt <= 0) return;
      // Don't yank the playhead if the user already scrubbed (desired seek or media).
      if (desiredMsRef.current != null && desiredMsRef.current > 250) return;
      const atMs = (audio!.currentTime || 0) * 1000;
      if (atMs > 250) return;
      desiredMsRef.current = pt;
      seekGuardUntilRef.current = performance.now() + 400;
      try {
        audio!.currentTime = pt / 1000;
      } catch {
        // ignore
      }
      clock.set(pt, {
        playing: !audio!.paused && !audio!.ended,
        rate: audio!.playbackRate > 0 ? audio!.playbackRate : 1,
      });
      setCurrentMs(pt);
    }

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
      seekPreviewIfNeeded();
      // Re-apply a pending user seek now that the media is seekable.
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
      // Only positions once (previewSeekDone); safe even though canplay
      // also fires after user seeks.
      seekPreviewIfNeeded();
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
      seekPreviewIfNeeded();
    }

    return () => {
      // Don't pause here — this effect re-runs on audioMountGen and must
      // not interrupt playback or snap the clock when re-attaching listeners.
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
  }, [audioUrl, audioMountGen]);

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
        data.rulesetShortName === "osu" || data.rulesetShortName === "fruits"
          ? `CS ${(data.circleSize ?? 5).toFixed(1)} · AR ${(data.approachRate ?? 5).toFixed(1)}`
          : data.columnCount > 0
            ? `${data.columnCount}K`
            : null,
        data.supported
          ? `OD ${(data.overallDifficulty ?? 0).toFixed(1)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const chartEndMs = (() => {
    let end = 0;
    for (const n of data?.notes ?? []) {
      end = Math.max(end, n.endMs, n.startMs);
    }
    for (const o of data?.hitObjects ?? []) {
      if (o.type === "circle") end = Math.max(end, o.timeMs);
      else end = Math.max(end, o.endMs);
    }
    for (const o of data?.taikoHitObjects ?? []) {
      if (o.type === "hit") end = Math.max(end, o.timeMs);
      else end = Math.max(end, o.endMs);
    }
    for (const o of data?.catchHitObjects ?? []) {
      end = Math.max(end, o.timeMs);
    }
    return end;
  })();
  const maxDuration = (() => {
    const candidates = [
      durationMs,
      data?.lengthMs ?? 0,
      chartEndMs,
    ].filter((n) => Number.isFinite(n) && n > 0 && n < 24 * 60 * 60 * 1000);
    const base = candidates.length > 0 ? Math.max(...candidates) : 1;
    return Math.max(base, currentMs, 1);
  })();
  const scrollLabel = Math.round(prefs.scroll);
  const fullscreen = prefs.fullscreen;
  const isMania =
    data?.rulesetShortName === "mania" &&
    Boolean(data.supported) &&
    (data.columnCount ?? 0) > 0;
  const isStd =
    data?.rulesetShortName === "osu" &&
    Boolean(data.supported) &&
    (data.hitObjects?.length ?? 0) > 0;
  const isTaiko =
    data?.rulesetShortName === "taiko" &&
    Boolean(data.supported) &&
    (data.taikoHitObjects?.length ?? 0) > 0;
  const isCatch =
    data?.rulesetShortName === "fruits" &&
    Boolean(data.supported) &&
    (data.catchHitObjects?.length ?? 0) > 0;
  const isLetterbox = isStd || isCatch;
  const binds =
    isMania ? resolveKeybinds(keybindsAll, data!.columnCount) : [];
  const isPlay = mode === "play";
  const solidBlack = isPlay && prefs.blackBg;
  // Full chart on the field so judgment noteIndex stays aligned; practiceRange
  // only limits which notes LiveManiaPlay judges.
  const fieldNotes = data?.notes ?? [];
  const fieldHitObjects = data?.hitObjects ?? [];

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
      <ManiaSkinDropHost
        enabled={isMania}
        className="flex h-full w-full items-stretch justify-center"
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
            : isLetterbox
              ? "relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,64rem)] sm:max-w-[min(96vw,96rem)] sm:rounded-2xl"
              : "relative flex h-full max-h-none w-full max-w-none flex-col overflow-hidden rounded-none bg-canvas shadow-2xl shadow-black/70 outline-none sm:h-[min(96vh,58rem)] sm:max-w-6xl sm:rounded-2xl"
        }
        onClick={(e) => e.stopPropagation()}
      >
        {audioUrl ? (
          <audio
            key={audioUrl}
            ref={bindAudioRef}
            src={audioUrl}
            preload="auto"
            className="hidden"
            aria-hidden
          />
        ) : null}
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
              className="truncate font-display text-xl font-bold text-on-media sm:text-2xl"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-on-media-muted">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {data?.supported && isMania ? (
              <div className="mr-1 flex rounded-full bg-black/40 p-0.5 ring-1 ring-white/10">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm transition ${
                    !isPlay
                      ? "bg-accent-glow text-on-media"
                      : "text-on-media-muted hover:text-on-media"
                  }`}
                  onClick={enterPreviewMode}
                >
                  Preview
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
                  enterPreviewMode();
                  return;
                }
                onClose();
              }}
              className="rounded-full px-3 py-1 text-sm text-on-media-muted transition hover:bg-white/10 hover:text-on-media"
              aria-label={isPlay ? "Back to preview" : "Close"}
              title={isPlay ? "Back to preview (Esc)" : "Close (Esc)"}
            >
              Esc
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <p className="flex flex-1 items-center justify-center px-5 py-10 text-center text-sm text-on-media-muted">
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
                className={
                  isLetterbox
                    ? fullscreen
                      ? "relative mx-auto min-h-0 w-full max-w-none flex-1 px-1 py-1 sm:px-2 sm:py-2"
                      : "relative mx-auto min-h-0 w-full max-w-none flex-1 px-2 py-2 sm:px-3 sm:py-3"
                    : fullscreen
                      ? "relative mx-auto min-h-0 w-full flex-1 px-2 py-1 sm:px-4 sm:py-2"
                      : "relative mx-auto min-h-0 w-full max-w-2xl flex-1 px-3 py-2 sm:max-w-3xl sm:px-6 sm:py-4"
                }
                style={
                  fullscreen && !isLetterbox
                    ? { maxWidth: `${prefs.fieldWidth}%` }
                    : undefined
                }
              >
                {isMania ? (
                  <NotefieldStage
                    columnCount={data.columnCount}
                    notes={fieldNotes}
                    scrollSpeed={prefs.scroll}
                    playbackRate={prefs.rate}
                    liveHeldMask={isPlay ? liveHeldMask : null}
                    getCurrentTimeMs={mapTimeMs}
                    timingX={prefs.timingX}
                    timingY={prefs.timingY}
                    onMoveTiming={(timingX, timingY) =>
                      setPrefs((p) => ({ ...p, timingX, timingY }))
                    }
                    windows={maniaHitWindows(data.overallDifficulty ?? 0)}
                    showTiming={isPlay}
                    judgments={isPlay ? liveJudgments : undefined}
                  />
                ) : isStd ? (
                  <div className="relative h-full w-full">
                    <div className="h-full w-full overflow-hidden rounded-xl">
                      <StdPlayfield
                        hitObjects={fieldHitObjects}
                        circleSize={data.circleSize ?? 5}
                        approachRate={data.approachRate ?? 5}
                        getCurrentTimeMs={mapTimeMs}
                        skin={stdSkin}
                      />
                    </div>
                  </div>
                ) : isTaiko ? (
                  <div className="relative h-full w-full overflow-hidden rounded-xl">
                    <TaikoPlayfield
                      hitObjects={data.taikoHitObjects ?? []}
                      getCurrentTimeMs={mapTimeMs}
                      skin={taikoSkin}
                    />
                  </div>
                ) : isCatch ? (
                  <div className="relative h-full w-full">
                    <div className="h-full w-full overflow-hidden rounded-xl">
                      <CatchPlayfield
                        hitObjects={data.catchHitObjects ?? []}
                        circleSize={data.circleSize ?? 5}
                        approachRate={data.approachRate ?? 5}
                        getCurrentTimeMs={mapTimeMs}
                        skin={catchSkin}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[16rem] items-center justify-center rounded-xl bg-black/40 px-6 text-center text-sm text-on-media-muted">
                    {data.rulesetShortName === "mania" ||
                    data.rulesetShortName === "osu" ||
                    data.rulesetShortName === "taiko" ||
                    data.rulesetShortName === "fruits"
                      ? "Could not load playfield for this map."
                      : "Playfield preview supports mania, standard, taiko, and catch. Audio and background still work."}
                  </div>
                )}
              </div>

              <div className="group/ctrl absolute inset-x-0 bottom-0 z-20">
                <div
                  className="absolute inset-x-0 bottom-0 h-14"
                  aria-hidden
                />
                <div className="pointer-events-none relative translate-y-full border-t border-white/10 bg-black/55 px-4 py-3 opacity-0 backdrop-blur transition duration-200 group-hover/ctrl:pointer-events-auto group-hover/ctrl:translate-y-0 group-hover/ctrl:opacity-100 group-focus-within/ctrl:pointer-events-auto group-focus-within/ctrl:translate-y-0 group-focus-within/ctrl:opacity-100 sm:px-6 sm:py-4">

                {audioError || !audioUrl ? (
                  <p className="mb-3 text-sm text-amber-200/90">
                    {audioError ??
                      "Audio not available locally — re-sync after updating Roxysu to resolve audio hashes."}
                  </p>
                ) : null}

                <div className="mb-3 flex items-center gap-3">
                  <span className="w-16 shrink-0 tabular-nums text-xs text-on-media-muted sm:w-20">
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
                        disabled={!audioUrl || !isMania}
                        onClick={enterTestFromHere}
                        title="Play from here (T)"
                      >
                        Test
                      </button>
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
                          rate: Number(e.target.value),
                        }))
                      }
                      aria-label="Playback rate"
                    >
                      {PRESET_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </label>

                  {isMania ? (
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

                  {isMania ? (
                    <>
                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-on-media-muted sm:max-w-xs">
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

                  <label className="flex min-w-[10rem] flex-1 items-center gap-2 text-xs text-on-media-muted sm:max-w-xs">
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
                    </>
                  ) : null}

                  {fullscreen && !isLetterbox ? (
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

                  <label className="flex cursor-pointer items-center gap-2 text-xs text-on-media-muted">
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

                <p className="mt-2 hidden text-[11px] text-on-media-muted sm:block">
                  {isPlay ? (
                    <>
                      Keys{" "}
                      {binds.map((c) => formatKeyCode(c)).join(" ")} · R restart
                      · Esc preview
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
                      Enter play · T test here · Space play · ← → skip 5s · Home
                      start · P preview · F fullscreen · [ ] scroll · , . rate
                      {" · "}
                      <a
                        href="#/skin"
                        className="text-on-media-muted underline-offset-2 hover:underline"
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
      </ManiaSkinDropHost>
    </div>
  );
}
