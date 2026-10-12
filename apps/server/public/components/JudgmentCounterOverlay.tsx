import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { clamp, formatAccuracy } from "../lib/format";
import type { JudgmentCounts } from "../lib/maniaWindows";
import { JUDGMENT_COLORS, type ReplayJudgmentResult } from "./ManiaNotefield";

const ORDER: ReplayJudgmentResult[] = [
  "perfect",
  "great",
  "good",
  "ok",
  "meh",
  "miss",
];

export const COUNTER_X_DEFAULT = 90;
export const COUNTER_Y_DEFAULT = 48;
export const COMBO_X_DEFAULT = 12;
export const COMBO_Y_DEFAULT = 10;
export const ACCURACY_X_DEFAULT = 88;
export const ACCURACY_Y_DEFAULT = 10;

/** How far a chip center may sit past the playfield's left or right edge. */
export const HUD_OFF_PX = 200;

function placeHud(
  anchor: HTMLElement,
  stage: HTMLElement,
  xPct: number,
  yPct: number,
): { left: number; top: number } | null {
  const ar = anchor.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  if (ar.width <= 0 || ar.height <= 0) return null;
  return {
    left: ar.left - sr.left + (xPct / 100) * ar.width,
    top: ar.top - sr.top + (yPct / 100) * ar.height,
  };
}

function DraggableHud({
  anchor,
  stage,
  xPct,
  yPct,
  onMove,
  label,
  children,
}: {
  anchor: HTMLElement;
  stage: HTMLElement;
  xPct: number;
  yPct: number;
  onMove: (xPct: number, yPct: number) => void;
  label: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const next = placeHud(anchor, stage, xPct, yPct);
      if (!next) return;
      setPos(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(anchor);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [anchor, stage, xPct, yPct]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const el = wrap;
    e.preventDefault();
    e.stopPropagation();
    const wrapRect = el.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - (wrapRect.left + wrapRect.width / 2),
      offsetY: e.clientY - (wrapRect.top + wrapRect.height / 2),
    };
    el.setPointerCapture(e.pointerId);

    function onPointerMove(ev: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const ar = anchor.getBoundingClientRect();
      if (ar.width <= 0 || ar.height <= 0) return;
      const off = (HUD_OFF_PX / ar.width) * 100;
      let x = ((ev.clientX - drag.offsetX - ar.left) / ar.width) * 100;
      let y = ((ev.clientY - drag.offsetY - ar.top) / ar.height) * 100;
      x = clamp(x, -off, 100 + off);
      y = clamp(y, 4, 96);
      const sr = stage.getBoundingClientRect();
      const centerX = ar.left + (x / 100) * ar.width;
      const minX = sr.left + 8;
      const maxX = sr.right - 8;
      if (centerX < minX) x = ((minX - ar.left) / ar.width) * 100;
      else if (centerX > maxX) x = ((maxX - ar.left) / ar.width) * 100;
      onMoveRef.current(x, y);
    }

    function onPointerUp(ev: PointerEvent) {
      if (dragRef.current?.pointerId !== ev.pointerId) return;
      dragRef.current = null;
      el.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  return (
    <div
      ref={wrapRef}
      className="absolute z-10 cursor-grab touch-none active:cursor-grabbing"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
        transform: "translate(-50%, -50%)",
      }}
      onPointerDown={onPointerDown}
      title="Drag to move"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function JudgmentCounterOverlay({
  anchor,
  stage,
  counts,
  xPct,
  yPct,
  onMove,
}: {
  anchor: HTMLElement;
  stage: HTMLElement;
  counts: JudgmentCounts;
  xPct: number;
  yPct: number;
  onMove: (xPct: number, yPct: number) => void;
}) {
  return (
    <DraggableHud
      anchor={anchor}
      stage={stage}
      xPct={xPct}
      yPct={yPct}
      onMove={onMove}
      label="Judgment counts"
    >
      <div className="flex flex-col items-end gap-0.5 rounded-lg bg-black/55 px-3 py-2 tabular-nums backdrop-blur">
        {ORDER.map((key) => (
          <span
            key={key}
            className="font-display text-3xl font-bold leading-none sm:text-4xl"
            style={{ color: JUDGMENT_COLORS[key] }}
          >
            {counts[key]}
          </span>
        ))}
      </div>
    </DraggableHud>
  );
}

export function ComboHudOverlay({
  anchor,
  stage,
  combo,
  maxCombo,
  xPct,
  yPct,
  onMove,
}: {
  anchor: HTMLElement;
  stage: HTMLElement;
  combo: number;
  maxCombo?: number;
  xPct: number;
  yPct: number;
  onMove: (xPct: number, yPct: number) => void;
}) {
  return (
    <DraggableHud
      anchor={anchor}
      stage={stage}
      xPct={xPct}
      yPct={yPct}
      onMove={onMove}
      label="Combo"
    >
      <div className="rounded-lg bg-black/55 px-3 py-2 backdrop-blur">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-on-media-muted">
          Combo
        </div>
        <div className="font-display text-2xl font-bold tabular-nums text-on-media">
          {combo}
          <span className="text-base text-on-media-muted">x</span>
        </div>
        {maxCombo != null ? (
          <div className="text-[10px] tabular-nums text-on-media-muted">
            max {maxCombo}x
          </div>
        ) : null}
      </div>
    </DraggableHud>
  );
}

export function AccuracyHudOverlay({
  anchor,
  stage,
  accuracy,
  last,
  xPct,
  yPct,
  onMove,
}: {
  anchor: HTMLElement;
  stage: HTMLElement;
  accuracy: number;
  last?: ReplayJudgmentResult | null;
  xPct: number;
  yPct: number;
  onMove: (xPct: number, yPct: number) => void;
}) {
  return (
    <DraggableHud
      anchor={anchor}
      stage={stage}
      xPct={xPct}
      yPct={yPct}
      onMove={onMove}
      label="Accuracy"
    >
      <div className="rounded-lg bg-black/55 px-3 py-2 text-right backdrop-blur">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-on-media-muted">
          Accuracy
        </div>
        <div className="font-display text-2xl font-bold tabular-nums text-on-media">
          {formatAccuracy(accuracy)}
        </div>
        {last ? (
          <div
            className="mt-0.5 text-xs font-bold uppercase tracking-wide"
            style={{ color: JUDGMENT_COLORS[last] }}
          >
            {last}
          </div>
        ) : null}
      </div>
    </DraggableHud>
  );
}
