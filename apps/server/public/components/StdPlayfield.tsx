import { useEffect, useRef } from "react";
import type { BeatmapPreview, ScoreReplay } from "../lib/api";
import type { ReplayJudgmentResult } from "./ManiaNotefield";

const OSU_WIDTH = 512;
const OSU_HEIGHT = 384;

type StdHitObject = NonNullable<BeatmapPreview["hitObjects"]>[number];

export type StdPlayfieldFrame = {
  tMs: number;
  x: number;
  y: number;
  buttons: number;
};

export type StdPlayfieldJudgment = {
  noteIndex: number;
  tMs: number;
  result: ReplayJudgmentResult;
  errorMs?: number | null;
};

type StdPlayfieldProps = {
  hitObjects: StdHitObject[];
  circleSize: number;
  approachRate: number;
  /** Returns current playback time in milliseconds (read each frame). */
  getCurrentTimeMs: () => number;
  /** Replay cursor frames (osu! coords). */
  frames?: StdPlayfieldFrame[];
  /** Precomputed judgments keyed by hit-object index. */
  judgments?: StdPlayfieldJudgment[];
  className?: string;
};

const JUDGMENT_COLORS: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffe566",
  great: "#7dd3fc",
  good: "#86efac",
  ok: "#fdba74",
  meh: "#f9a8d4",
  miss: "#f87171",
};

function approachPreemptMs(ar: number): number {
  if (ar < 5) return 1800 - 120 * ar;
  return 1200 - 150 * (ar - 5);
}

function approachFadeInMs(ar: number): number {
  if (ar < 5) return 1200 - 120 * ar;
  return 800 - 100 * (ar - 5);
}

function circleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

function bisectLeft(objects: StdHitObject[], timeMs: number): number {
  let lo = 0;
  let hi = objects.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (objects[mid]!.timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectFrame(frames: StdPlayfieldFrame[], timeMs: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function objectEndMs(obj: StdHitObject): number {
  if (obj.type === "circle") return obj.timeMs;
  return obj.endMs;
}

function buildJudgmentMap(
  judgments: StdPlayfieldJudgment[] | undefined,
): Map<number, StdPlayfieldJudgment> {
  const map = new Map<number, StdPlayfieldJudgment>();
  if (!judgments) return map;
  for (const j of judgments) {
    if (!map.has(j.noteIndex)) map.set(j.noteIndex, j);
  }
  return map;
}

function interpolateCursor(
  frames: StdPlayfieldFrame[],
  t: number,
): { x: number; y: number; buttons: number } | null {
  if (frames.length === 0) return null;
  const idx = bisectFrame(frames, t);
  if (idx < 0) return { x: frames[0]!.x, y: frames[0]!.y, buttons: 0 };
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) {
    return { x: a.x, y: a.y, buttons: a.buttons };
  }
  const u = Math.min(1, Math.max(0, (t - a.tMs) / (b.tMs - a.tMs)));
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    buttons: a.buttons,
  };
}

/**
 * Standard (osu!) playfield — 512×384 letterboxed into the modal stage.
 * Scrub-only for preview; pass frames for replay cursor overlay.
 */
export function StdPlayfield({
  hitObjects,
  circleSize,
  approachRate,
  getCurrentTimeMs,
  frames,
  judgments,
  className = "",
}: StdPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<StdHitObject[]>([]);
  const getTimeRef = useRef(getCurrentTimeMs);
  const framesRef = useRef<StdPlayfieldFrame[]>([]);
  const judgmentsRef = useRef<Map<number, StdPlayfieldJudgment>>(new Map());
  const csRef = useRef(circleSize);
  const arRef = useRef(approachRate);
  const trailRef = useRef<Array<{ x: number; y: number; t: number }>>([]);

  objectsRef.current = hitObjects;
  getTimeRef.current = getCurrentTimeMs;
  framesRef.current = frames ?? [];
  judgmentsRef.current = buildJudgmentMap(judgments);
  csRef.current = circleSize;
  arRef.current = approachRate;

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
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });

    function playfieldTransform(w: number, h: number) {
      const scale = Math.min(w / OSU_WIDTH, h / OSU_HEIGHT);
      const ox = (w - OSU_WIDTH * scale) / 2;
      const oy = (h - OSU_HEIGHT * scale) / 2;
      return { scale, ox, oy };
    }

    function draw() {
      if (!running) return;
      const t = getTimeRef.current();
      const objs = objectsRef.current;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const cs = csRef.current;
      const ar = arRef.current;
      const preempt = approachPreemptMs(ar);
      const fadeIn = approachFadeInMs(ar);
      const radius = circleRadius(cs);
      const { scale, ox, oy } = playfieldTransform(w, h);
      const jMap = judgmentsRef.current;
      const frameList = framesRef.current;

      ctx!.clearRect(0, 0, w, h);

      // Dim playfield plate.
      ctx!.fillStyle = "rgba(0,0,0,0.45)";
      ctx!.fillRect(ox, oy, OSU_WIDTH * scale, OSU_HEIGHT * scale);
      ctx!.strokeStyle = "rgba(255,255,255,0.12)";
      ctx!.lineWidth = 1;
      ctx!.strokeRect(
        ox + 0.5,
        oy + 0.5,
        OSU_WIDTH * scale - 1,
        OSU_HEIGHT * scale - 1,
      );

      const toScreen = (x: number, y: number) => ({
        sx: ox + x * scale,
        sy: oy + y * scale,
      });

      // Visible window: objects whose approach has started and not long past.
      const startIdx = Math.max(0, bisectLeft(objs, t - 2000) - 2);
      const visible: Array<{ obj: StdHitObject; index: number }> = [];
      for (let i = startIdx; i < objs.length; i += 1) {
        const obj = objs[i]!;
        if (obj.timeMs - preempt > t + 50) break;
        const end = objectEndMs(obj);
        const judgment = jMap.get(i);
        const hideAfter =
          judgment != null
            ? judgment.tMs + (judgment.result === "miss" ? 200 : 120)
            : end + Math.max(200, preempt * 0.15);
        if (t > hideAfter) continue;
        visible.push({ obj, index: i });
      }

      // Draw earliest first so later objects sit on top.
      for (const { obj, index } of visible) {
        const judgment = jMap.get(index);
        const judged =
          judgment != null && t >= judgment.tMs - 1;
        const alphaFromApproach = (() => {
          const appear = obj.timeMs - preempt;
          if (t < appear) return 0;
          if (t < appear + fadeIn) return (t - appear) / fadeIn;
          return 1;
        })();

        if (obj.type === "spinner") {
          const progress = Math.min(
            1,
            Math.max(0, (t - obj.timeMs) / Math.max(1, obj.endMs - obj.timeMs)),
          );
          const { sx, sy } = toScreen(OSU_WIDTH / 2, OSU_HEIGHT / 2);
          const r = Math.min(OSU_WIDTH, OSU_HEIGHT) * 0.35 * scale;
          ctx!.globalAlpha = Math.min(1, alphaFromApproach);
          ctx!.strokeStyle = judged
            ? JUDGMENT_COLORS[judgment!.result]
            : "rgba(255,255,255,0.7)";
          ctx!.lineWidth = 4 * scale;
          ctx!.beginPath();
          ctx!.arc(sx, sy, r, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.beginPath();
          ctx!.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx!.strokeStyle = "#fbbf24";
          ctx!.stroke();
          ctx!.globalAlpha = 1;
          continue;
        }

        const hx = obj.stackX;
        const hy = obj.stackY;
        const { sx, sy } = toScreen(hx, hy);
        const r = radius * scale;

        if (obj.type === "slider" && obj.path.length > 1) {
          ctx!.globalAlpha = Math.min(0.85, alphaFromApproach);
          ctx!.strokeStyle = "rgba(165, 180, 252, 0.85)";
          ctx!.lineWidth = r * 1.7;
          ctx!.lineCap = "round";
          ctx!.lineJoin = "round";
          ctx!.beginPath();
          for (let p = 0; p < obj.path.length; p += 1) {
            const pt = obj.path[p]!;
            const sp = toScreen(pt.x, pt.y);
            if (p === 0) ctx!.moveTo(sp.sx, sp.sy);
            else ctx!.lineTo(sp.sx, sp.sy);
          }
          ctx!.stroke();
          // Inner track.
          ctx!.strokeStyle = "rgba(30, 30, 40, 0.9)";
          ctx!.lineWidth = r * 1.15;
          ctx!.stroke();

          // Slider ball along path while active.
          if (t >= obj.timeMs && t <= obj.endMs) {
            const span = Math.max(1, obj.endMs - obj.timeMs);
            const u = (t - obj.timeMs) / span;
            // Bounce on repeats.
            const repeats = Math.max(1, obj.repeats);
            const prog = u * repeats;
            const seg = Math.floor(prog);
            let local = prog - seg;
            if (seg % 2 === 1) local = 1 - local;
            const pathIdx = Math.min(
              obj.path.length - 1,
              Math.floor(local * (obj.path.length - 1)),
            );
            const ball = obj.path[pathIdx]!;
            const bp = toScreen(ball.x, ball.y);
            ctx!.fillStyle = "#fbbf24";
            ctx!.beginPath();
            ctx!.arc(bp.sx, bp.sy, r * 0.85, 0, Math.PI * 2);
            ctx!.fill();
          }
        }

        // Approach circle.
        if (!judged && t < obj.timeMs) {
          const remain = (obj.timeMs - t) / preempt;
          const approachR = r * (1 + 3 * Math.max(0, remain));
          ctx!.globalAlpha = Math.min(1, alphaFromApproach);
          ctx!.strokeStyle = "rgba(255,255,255,0.85)";
          ctx!.lineWidth = 2.5 * scale;
          ctx!.beginPath();
          ctx!.arc(sx, sy, approachR, 0, Math.PI * 2);
          ctx!.stroke();
        }

        // Hit circle / slider head.
        const fill =
          judged && judgment
            ? JUDGMENT_COLORS[judgment.result]
            : "#c4b5fd";
        ctx!.globalAlpha = judged
          ? Math.max(0, 1 - (t - (judgment?.tMs ?? t)) / 150)
          : Math.min(1, alphaFromApproach);
        ctx!.fillStyle = fill;
        ctx!.beginPath();
        ctx!.arc(sx, sy, r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = "rgba(255,255,255,0.9)";
        ctx!.lineWidth = 2 * scale;
        ctx!.stroke();
        // Combo ring
        ctx!.strokeStyle = "rgba(0,0,0,0.35)";
        ctx!.lineWidth = 4 * scale;
        ctx!.beginPath();
        ctx!.arc(sx, sy, r * 0.72, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }

      // Cursor + trail from replay frames.
      const cursor = interpolateCursor(frameList, t);
      if (cursor) {
        const trail = trailRef.current;
        trail.push({ x: cursor.x, y: cursor.y, t });
        while (trail.length > 0 && t - trail[0]!.t > 180) trail.shift();
        if (trail.length > 40) trail.splice(0, trail.length - 40);

        ctx!.lineWidth = 2 * scale;
        ctx!.strokeStyle = "rgba(255,255,255,0.25)";
        ctx!.beginPath();
        for (let i = 0; i < trail.length; i += 1) {
          const p = toScreen(trail[i]!.x, trail[i]!.y);
          if (i === 0) ctx!.moveTo(p.sx, p.sy);
          else ctx!.lineTo(p.sx, p.sy);
        }
        ctx!.stroke();

        const cp = toScreen(cursor.x, cursor.y);
        const clicking = (cursor.buttons & 1) !== 0 || (cursor.buttons & 2) !== 0;
        ctx!.fillStyle = clicking
          ? "rgba(251, 191, 36, 0.95)"
          : "rgba(255,255,255,0.9)";
        ctx!.beginPath();
        ctx!.arc(cp.sx, cp.sy, 6 * scale, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = "rgba(0,0,0,0.5)";
        ctx!.lineWidth = 1.5 * scale;
        ctx!.stroke();
      }

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
      className={`block h-full w-full ${className}`.trim()}
      aria-hidden
    />
  );
}

/** Type helper — hit objects on score replay beatmap payload. */
export type StdReplayHitObjects = NonNullable<
  ScoreReplay["beatmap"]
>["hitObjects"];
