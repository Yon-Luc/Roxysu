import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { fetchBeatmapPreview, type BeatmapPreview } from "../lib/api";
import { AudioClock, sampleAudioClock } from "../lib/audioClock";
import { clamp, formatClock } from "../lib/format";
import { localBeatmapAudioUrl } from "../lib/osuUrls";
import { useStdSkin } from "../lib/stdSkin";
import { usePreviewSkin } from "../lib/previewSkin";
import { NotefieldStage } from "./NotefieldStage";
import { StdPlayfield } from "./StdPlayfield";
import { maniaHitWindows } from "../lib/maniaWindows";
import {
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
} from "./ManiaNotefield";
import { loadPrefs, SKIP_MS } from "./previewPrefs";
import { useAppDict } from "../lib/i18n";

export function BeatmapPreviewEmbed({
  beatmapId,
  autoPlay,
  muted,
  playingAllowed,
}: {
  beatmapId: string;
  autoPlay: boolean;
  muted: boolean;
  /** When false (in-game play), pause so game audio is not doubled. */
  playingAllowed: boolean;
}) {
  const { dict } = useAppDict();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioMountGen, setAudioMountGen] = useState(0);
  const bindAudioRef = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
    if (el) setAudioMountGen((n) => n + 1);
  }, []);
  const clockRef = useRef(new AudioClock());
  const previewSeekDone = useRef(false);
  const desiredMsRef = useRef<number | null>(null);
  const seekGuardUntilRef = useRef(0);
  const lengthMsRef = useRef(0);
  const durationMsRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const playingAllowedRef = useRef(playingAllowed);
  const autoPlayRef = useRef(autoPlay);
  const mutedRef = useRef(muted);

  const prefs = loadPrefs();
  const skin = usePreviewSkin();
  const stdSkin = useStdSkin();
  void skin;

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [volume, setVolume] = useState(prefs.volume);
  const [scroll, setScroll] = useState(prefs.scroll);

  playingAllowedRef.current = playingAllowed;
  autoPlayRef.current = autoPlay;
  mutedRef.current = muted;

  const { data, error, isLoading } = useQuery({
    queryKey: ["beatmap-preview", beatmapId],
    queryFn: () => fetchBeatmapPreview(beatmapId) as Promise<BeatmapPreview>,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const audioUrl = localBeatmapAudioUrl(data?.audioFileHash);
  const previewTime =
    data?.previewTime != null && data.previewTime > 0 ? data.previewTime : null;

  audioUrlRef.current = audioUrl;
  {
    let chartEnd = 0;
    for (const n of data?.notes ?? []) {
      chartEnd = Math.max(chartEnd, n.endMs, n.startMs);
    }
    for (const o of data?.hitObjects ?? []) {
      chartEnd = Math.max(chartEnd, o.type === "circle" ? o.timeMs : o.endMs);
    }
    lengthMsRef.current = Math.max(0, data?.lengthMs ?? 0, chartEnd);
  }
  durationMsRef.current = durationMs;

  function mapTimeMs(): number {
    return sampleAudioClock(clockRef.current, audioRef.current, currentMs);
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
      // InvalidStateError before metadata
    }
    clockRef.current.set(next, {
      playing: !audio.paused && !audio.ended,
      rate: audio.playbackRate > 0 ? audio.playbackRate : 1,
    });
    setCurrentMs(next);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !audioUrlRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setAudioError(
          dict?.nowSelected.playbackBlocked ?? "Playback blocked — click play",
        );
      });
    } else {
      audio.pause();
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted, audioUrl]);

  useEffect(() => {
    previewSeekDone.current = false;
    desiredMsRef.current = null;
    clockRef.current.set(0, { playing: false, rate: 1 });
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

    function seekPreviewIfNeeded() {
      if (previewSeekDone.current) return;
      previewSeekDone.current = true;
      const pt = previewTime;
      if (pt == null || pt <= 0) return;
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

    function tryAutoPlay() {
      if (!autoPlayRef.current || !playingAllowedRef.current) return;
      if (!audioUrlRef.current) return;
      void audio!.play().catch(() => {
        /* autoplay may be blocked until a click */
      });
    }

    function syncClockFromAudio() {
      const ms = (audio!.currentTime || 0) * 1000;
      const desired = desiredMsRef.current;
      if (desired != null) {
        if (Math.abs(ms - desired) <= 400) {
          desiredMsRef.current = null;
        } else if (performance.now() < seekGuardUntilRef.current) {
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

    function onLoadedMetadata() {
      setDurationMs((audio!.duration || 0) * 1000);
      seekPreviewIfNeeded();
      tryAutoPlay();
    }
    function onCanPlay() {
      seekPreviewIfNeeded();
      tryAutoPlay();
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
      setAudioError(
        dict?.nowSelected.audioUnavailable ?? "Audio not available locally",
      );
    }
    function onTimeUpdate() {
      syncClockFromAudio();
    }

    audio.volume = volume;
    audio.muted = mutedRef.current;

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
      tryAutoPlay();
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, audioMountGen]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (!playingAllowed) {
      audio.pause();
      return;
    }
    if (autoPlay && audio.paused) {
      void audio.play().catch(() => {
        /* ignore */
      });
    }
  }, [playingAllowed, autoPlay, audioUrl]);

  function onSeek(e: FormEvent<HTMLInputElement>) {
    seekTo(Number(e.currentTarget.value));
  }

  const isMania =
    data?.supported &&
    data.rulesetShortName === "mania" &&
    data.columnCount > 0;
  const isStd =
    data?.supported &&
    data.rulesetShortName === "osu" &&
    (data.hitObjects?.length ?? 0) > 0;
  const maxDuration = Math.max(durationMs, lengthMsRef.current);

  return (
    <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-white/8 bg-black/40">
      {audioUrl ? (
        <audio
          ref={bindAudioRef}
          src={audioUrl}
          preload="auto"
          muted={muted}
          className="hidden"
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <p className="flex h-full min-h-[16rem] items-center justify-center px-4 text-sm text-muted">
            {dict?.nowSelected.loadingPreview ?? "Loading preview…"}
          </p>
        ) : error ? (
          <p className="flex h-full min-h-[16rem] items-center justify-center px-4 text-center text-sm text-rose-300">
            {error instanceof Error
              ? error.message
              : (dict?.nowSelected.previewFailed ?? "Failed to load preview")}
          </p>
        ) : data ? (
          <div className="h-full min-h-[16rem] px-2 py-2 sm:px-3">
            {isMania ? (
              <NotefieldStage
                columnCount={data.columnCount}
                notes={data.notes}
                scrollSpeed={scroll}
                playbackRate={1}
                liveHeldMask={null}
                getCurrentTimeMs={mapTimeMs}
                timingX={50}
                timingY={50}
                onMoveTiming={() => {}}
                windows={maniaHitWindows(data.overallDifficulty ?? 0)}
                showTiming={false}
              />
            ) : isStd ? (
              <div className="h-full w-full overflow-hidden rounded-xl">
                <StdPlayfield
                  hitObjects={data.hitObjects ?? []}
                  circleSize={data.circleSize ?? 5}
                  approachRate={data.approachRate ?? 5}
                  getCurrentTimeMs={mapTimeMs}
                  skin={stdSkin}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] items-center justify-center px-4 text-center text-sm text-muted">
                {dict?.nowSelected.previewUnsupported ??
                  "Playfield preview supports mania and standard."}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 bg-black/50 px-3 py-2">
        {audioError || (!isLoading && data && !audioUrl) ? (
          <p className="mb-2 text-xs text-amber-200/90">
            {audioError ??
              (dict?.nowSelected.audioUnavailable ??
                "Audio not available locally")}
          </p>
        ) : null}
        <div className="mb-2 flex items-center gap-2">
          <span className="w-12 shrink-0 tabular-nums text-[11px] text-muted">
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
            className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-40"
            aria-label={dict?.nowSelected.seek ?? "Seek"}
          />
          <span className="w-12 shrink-0 text-right tabular-nums text-[11px] text-muted">
            {formatClock(maxDuration)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rx-btn-primary !px-3 !py-1 text-xs"
            onClick={togglePlay}
            disabled={!audioUrl || !playingAllowed}
          >
            {playing
              ? (dict?.nowSelected.pause ?? "Pause")
              : (dict?.nowSelected.play ?? "Play")}
          </button>
          <button
            type="button"
            className="rx-btn !px-3 !py-1 text-xs"
            disabled={!audioUrl}
            onClick={() => seekTo(previewTime != null && previewTime > 0 ? previewTime : 0)}
          >
            {dict?.nowSelected.previewPoint ?? "Preview"}
          </button>
          <button
            type="button"
            className="rx-btn !px-3 !py-1 text-xs"
            disabled={!audioUrl}
            onClick={() => seekTo(Math.max(0, mapTimeMs() - SKIP_MS))}
          >
            −5s
          </button>
          <button
            type="button"
            className="rx-btn !px-3 !py-1 text-xs"
            disabled={!audioUrl}
            onClick={() => seekTo(mapTimeMs() + SKIP_MS)}
          >
            +5s
          </button>
          {isMania ? (
            <label className="ml-auto flex min-w-[8rem] items-center gap-2 text-[11px] text-muted">
              <span className="shrink-0">
                {dict?.nowSelected.scroll ?? "Scroll"} {scroll}
              </span>
              <input
                type="range"
                min={PREVIEW_SCROLL_MIN}
                max={PREVIEW_SCROLL_MAX}
                step={1}
                value={scroll}
                onInput={(e) => setScroll(Number(e.currentTarget.value))}
                className="min-w-[4rem] flex-1 accent-[var(--accent)]"
              />
            </label>
          ) : (
            <label className="ml-auto flex min-w-[8rem] items-center gap-2 text-[11px] text-muted">
              <span className="shrink-0">{dict?.nowSelected.vol ?? "Vol"}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onInput={(e) => setVolume(Number(e.currentTarget.value))}
                className="min-w-[4rem] flex-1 accent-[var(--accent)]"
                disabled={muted}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
