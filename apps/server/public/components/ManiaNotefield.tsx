import { useEffect, useRef } from "react";
import type { BeatmapPreview } from "../lib/api";
import { clamp } from "../lib/format";
import {
  buildHeadJudgmentMap,
  clampScrollSpeed,
  paintManiaNotefield,
  PREVIEW_SCROLL_DEFAULT,
  type NotefieldFrame,
  type NotefieldJudgment,
} from "../lib/paintManiaNotefield";
import {
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  resolveKeymodeSkin,
  usePreviewSkin,
  type KeymodeSkin,
} from "../lib/previewSkin";

type Note = BeatmapPreview["notes"][number];

export type {
  NotefieldFrame,
  NotefieldJudgment,
  ReplayJudgmentResult,
} from "../lib/paintManiaNotefield";

export {
  JUDGMENT_COLORS,
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
} from "../lib/paintManiaNotefield";

type ManiaNotefieldProps = {
  columnCount: number;
  notes: Note[];
  /** Returns current playback time in milliseconds (read each frame). */
  getCurrentTimeMs: () => number;
  /**
   * osu!mania scroll speed (1–40). Notes take
   * `11485 / scrollSpeed` ms of map time to travel top → receptor at rate 1.
   * Visual px/s is kept independent of `playbackRate` (rate only slows/speeds
   * the song and hit timing).
   */
  scrollSpeed?: number;
  /**
   * Audio / map playback rate. Scroll px/wall-sec stays constant; only the
   * song and note timing stretch with rate.
   */
  playbackRate?: number;
  /** Override skin (e.g. live editor preview). Falls back to stored skin. */
  skinOverride?: KeymodeSkin;
  /** Replay key frames (bitmask per column). */
  frames?: NotefieldFrame[];
  /**
   * Live play held columns (bitmask). When set, overrides `frames` for
   * receptor lighting.
   */
  liveHeldMask?: number | null;
  /** Precomputed judgments keyed by note index (head result used for color). */
  judgments?: NotefieldJudgment[];
  /**
   * Analysis mode: draw a red rectangle around missed notes
   * (skin colors unchanged).
   */
  highlightMissNotes?: boolean;
  className?: string;
};

/**
 * Mania notefield — canvas wrapper around `paintManiaNotefield`.
 * Scrub/preview and replay share the same paint path.
 */
export function ManiaNotefield({
  columnCount,
  notes,
  getCurrentTimeMs,
  scrollSpeed = PREVIEW_SCROLL_DEFAULT,
  playbackRate = 1,
  skinOverride,
  frames,
  liveHeldMask = null,
  judgments,
  highlightMissNotes = false,
  className = "",
}: ManiaNotefieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<Note[]>([]);
  const columnsRef = useRef(columnCount);
  const getTimeRef = useRef(getCurrentTimeMs);
  const scrollSpeedRef = useRef(scrollSpeed);
  const playbackRateRef = useRef(playbackRate);
  const framesRef = useRef<NotefieldFrame[]>([]);
  const liveHeldMaskRef = useRef<number | null>(null);
  const headJudgmentsRef = useRef<Map<number, NotefieldJudgment>>(new Map());
  const highlightMissRef = useRef(highlightMissNotes);
  const storedSkin = usePreviewSkin();
  const keymodeSkin = skinOverride ?? resolveKeymodeSkin(storedSkin, columnCount);
  const skinRef = useRef(keymodeSkin);
  skinRef.current = keymodeSkin;
  const hitPositionRef = useRef(storedSkin.hitPosition);
  hitPositionRef.current = clamp(
    storedSkin.hitPosition,
    HIT_POSITION_MIN,
    HIT_POSITION_MAX,
  );
  const laneCoverRef = useRef(storedSkin.laneCover);
  laneCoverRef.current = clamp(
    storedSkin.laneCover,
    LANE_COVER_MIN,
    LANE_COVER_MAX,
  );

  notesRef.current = (() => {
    if (notes.length <= 1) return notes;
    let sorted = true;
    for (let i = 1; i < notes.length; i += 1) {
      if (notes[i]!.startMs < notes[i - 1]!.startMs) {
        sorted = false;
        break;
      }
    }
    return sorted ? notes : [...notes].sort((a, b) => a.startMs - b.startMs);
  })();
  columnsRef.current = columnCount;
  getTimeRef.current = getCurrentTimeMs;
  scrollSpeedRef.current = clampScrollSpeed(scrollSpeed);
  playbackRateRef.current =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  framesRef.current = frames ?? [];
  liveHeldMaskRef.current = liveHeldMask ?? null;
  headJudgmentsRef.current = buildHeadJudgmentMap(judgments);
  highlightMissRef.current = highlightMissNotes;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    // Flex layouts may settle after first paint; re-measure so the field isn't 1×1.
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });

    function draw() {
      if (!running) return;
      paintManiaNotefield({
        ctx: ctx!,
        width: canvas!.clientWidth,
        height: canvas!.clientHeight,
        tMs: getTimeRef.current(),
        columnCount: columnsRef.current,
        notes: notesRef.current,
        scrollSpeed: scrollSpeedRef.current,
        playbackRate: playbackRateRef.current,
        skin: skinRef.current,
        hitPosition: hitPositionRef.current,
        laneCover: laneCoverRef.current,
        frames: framesRef.current,
        liveHeldMask: liveHeldMaskRef.current,
        headJudgments: headJudgmentsRef.current,
        highlightMissNotes: highlightMissRef.current,
      });
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full ${className}`}
      aria-hidden
    />
  );
}
