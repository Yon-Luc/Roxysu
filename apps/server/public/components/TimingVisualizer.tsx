import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { HitWindows, JudgmentResult } from "../lib/maniaWindows";
import { clamp } from "../lib/format";
import { JUDGMENT_COLORS } from "./ManiaNotefield";

const FADE_MS = 2800;
const MAX_MARKS = 80;
const BAR_H = 28;
const BAR_W = 300;

export type TimingMark = {
  /** Hit offset in ms; null/undefined on miss. */
  errorMs?: number | null;
  result: JudgmentResult;
  /** Stable identity for streaming new marks. */
  noteIndex: number;
  isTail?: boolean;
};

type TimingVisualizerProps = {
  judgments: TimingMark[];
  windows: HitWindows;
  /** Center X as % of the containing block (0–100). */
  xPct: number;
  /** Center Y as % of the containing block (0–100). */
  yPct: number;
  onMove: (xPct: number, yPct: number) => void;
};

type ActiveMark = {
  errorMs: number;
  result: JudgmentResult;
  born: number;
  key: string;
};

function markKey(j: TimingMark): string {
  return `${j.noteIndex}:${j.isTail ? "t" : "h"}:${j.result}`;
}

/**
 * osu!-style hit error bar: recent presses as vertical ticks, colored by
 * judgment. Drag to reposition within the playfield.
 */
export function TimingVisualizer({
  judgments,
  windows,
  xPct,
  yPct,
  onMove,
}: TimingVisualizerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<ActiveMark[]>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Stream new judgments into the fade list (reset when list shrinks).
  useEffect(() => {
    if (judgments.length === 0) {
      marksRef.current = [];
      seenKeysRef.current.clear();
      return;
    }

    const seen = seenKeysRef.current;
    const nextKeys = new Set<string>();
    let added = false;
    for (const j of judgments) {
      const key = markKey(j);
      nextKeys.add(key);
      if (seen.has(key)) continue;
      if (j.errorMs == null || j.result === "miss") {
        seen.add(key);
        continue;
      }
      marksRef.current.push({
        errorMs: j.errorMs,
        result: j.result,
        born: performance.now(),
        key,
      });
      seen.add(key);
      added = true;
    }

    // Restart / truncated history — drop orphans.
    if (nextKeys.size < seen.size * 0.5 || judgments.length < seen.size) {
      const keep = new Set(nextKeys);
      for (const k of [...seen]) {
        if (!keep.has(k)) seen.delete(k);
      }
      marksRef.current = marksRef.current.filter((m) => keep.has(m.key));
    }

    if (added && marksRef.current.length > MAX_MARKS) {
      marksRef.current = marksRef.current.slice(-MAX_MARKS);
    }
  }, [judgments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let running = true;

    function draw(now: number) {
      if (!running || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = BAR_W;
      const cssH = BAR_H;
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const half = Math.max(1, windows.miss);
      const midX = cssW / 2;

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(midX - 1, 2, 2, cssH - 4);

      const alive: ActiveMark[] = [];
      for (const m of marksRef.current) {
        const age = now - m.born;
        if (age >= FADE_MS) continue;
        alive.push(m);
        const t = age / FADE_MS;
        const alpha = (1 - t) * (1 - t);
        const x = midX + (m.errorMs / half) * midX;
        const clampedX = clamp(x, 1, cssW - 2);
        ctx.fillStyle = withAlpha(JUDGMENT_COLORS[m.result], 0.25 + alpha * 0.75);
        ctx.shadowColor = JUDGMENT_COLORS[m.result];
        ctx.shadowBlur = 4 * alpha;
        ctx.fillRect(clampedX - 1, 3, 2, cssH - 6);
        ctx.shadowBlur = 0;
      }
      marksRef.current = alive;

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [windows]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const wrap = wrapRef.current;
    const parent = wrap?.parentElement;
    if (!wrap || !parent) return;
    e.preventDefault();
    e.stopPropagation();
    const parentRect = parent.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - (wrapRect.left + wrapRect.width / 2),
      offsetY: e.clientY - (wrapRect.top + wrapRect.height / 2),
    };
    wrap.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const pr = parent!.getBoundingClientRect();
      if (pr.width <= 0 || pr.height <= 0) return;
      const cx = ev.clientX - drag.offsetX;
      const cy = ev.clientY - drag.offsetY;
      const x = clamp(((cx - pr.left) / pr.width) * 100, 4, 96);
      const y = clamp(((cy - pr.top) / pr.height) * 100, 4, 96);
      onMoveRef.current(x, y);
    }

    function onUp(ev: PointerEvent) {
      if (dragRef.current?.pointerId !== ev.pointerId) return;
      dragRef.current = null;
      wrap!.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      ref={wrapRef}
      className="absolute z-10 cursor-grab touch-none active:cursor-grabbing"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: BAR_W,
        height: BAR_H,
        transform: "translate(-50%, -50%)",
      }}
      onPointerDown={onPointerDown}
      title="Drag to move timing bar"
      role="img"
      aria-label="Hit timing visualizer"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full rounded-md bg-black/70 ring-1 ring-white/15"
        style={{ width: BAR_W, height: BAR_H }}
      />
    </div>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  if (hex.startsWith("#") && hex.length === 7) {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return hex;
}

export const TIMING_VIS_X_DEFAULT = 50;
export const TIMING_VIS_Y_DEFAULT = 78;
