import { useEffect, useRef } from "react";
import type { BeatmapPreview } from "../lib/api";

const DEFAULT_SCROLL_PX_PER_MS = 0.55;
const RECEPTOR_Y_RATIO = 0.88;
const TAP_HEIGHT = 14;

type Note = BeatmapPreview["notes"][number];

type ManiaNotefieldProps = {
  columnCount: number;
  notes: Note[];
  /** Returns current playback time in milliseconds (read each frame). */
  getCurrentTimeMs: () => number;
  /** Pixels the notefield scrolls per millisecond. */
  scrollPxPerMs?: number;
  className?: string;
};

const COLUMN_COLORS = [
  "#7dd3fc",
  "#fda4af",
  "#a5b4fc",
  "#fde68a",
  "#86efac",
  "#f9a8d4",
  "#c4b5fd",
  "#fdba74",
  "#67e8f9",
  "#fca5a5",
];

function bisectLeft(notes: Note[], timeMs: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.startMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function ManiaNotefield({
  columnCount,
  notes,
  getCurrentTimeMs,
  scrollPxPerMs = DEFAULT_SCROLL_PX_PER_MS,
  className = "",
}: ManiaNotefieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<Note[]>([]);
  const columnsRef = useRef(columnCount);
  const getTimeRef = useRef(getCurrentTimeMs);
  const scrollRef = useRef(scrollPxPerMs);

  // Keep notes sorted by start for windowed drawing.
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
  scrollRef.current = Math.max(0.05, scrollPxPerMs);

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

    function draw() {
      if (!running) return;
      const cols = Math.max(1, columnsRef.current);
      const t = getTimeRef.current();
      const scroll = scrollRef.current;
      const noteList = notesRef.current;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const receptorY = h * RECEPTOR_Y_RATIO;
      const colW = w / cols;
      const gap = Math.max(1, colW * 0.04);
      const noteW = colW - gap * 2;
      const lookaheadMs = receptorY / scroll + 200;

      ctx!.clearRect(0, 0, w, h);

      ctx!.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx!.fillRect(0, 0, w, h);

      ctx!.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx!.lineWidth = 1;
      for (let c = 1; c < cols; c += 1) {
        const x = c * colW;
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
        ctx!.stroke();
      }

      // Notes only above the receptor — anything past the hit line is clipped.
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, 0, w, receptorY);
      ctx!.clip();

      const windowStart = t;
      const windowEnd = t + lookaheadMs;
      // Walk earlier so long notes that started before now still draw above the receptor.
      const startIdx = Math.max(0, bisectLeft(noteList, windowStart - 8000) - 1);

      for (let i = startIdx; i < noteList.length; i += 1) {
        const note = noteList[i]!;
        if (note.startMs > windowEnd) break;
        // Fully past the hit line — nothing left to show.
        if (note.endMs < windowStart) continue;

        const col = Math.min(cols - 1, Math.max(0, note.column));
        const x = col * colW + gap;
        const color = COLUMN_COLORS[col % COLUMN_COLORS.length]!;
        const isHold = note.endMs > note.startMs + 20;

        const startY = receptorY - (note.startMs - t) * scroll;
        if (isHold) {
          const endY = receptorY - (note.endMs - t) * scroll;
          const top = Math.min(startY, endY);
          const bottom = Math.max(startY, endY);
          const height = Math.max(TAP_HEIGHT, bottom - top);
          ctx!.fillStyle = color;
          ctx!.globalAlpha = 0.55;
          ctx!.fillRect(x, top, noteW, height);
          // Head only while it hasn't crossed the receptor yet.
          if (note.startMs >= t) {
            ctx!.globalAlpha = 0.95;
            ctx!.fillRect(x, startY - TAP_HEIGHT / 2, noteW, TAP_HEIGHT);
          }
          ctx!.globalAlpha = 1;
        } else if (note.startMs >= t) {
          ctx!.fillStyle = color;
          ctx!.globalAlpha = 0.95;
          ctx!.fillRect(x, startY - TAP_HEIGHT / 2, noteW, TAP_HEIGHT);
          ctx!.globalAlpha = 1;
        }
      }

      ctx!.restore();

      // Receptor drawn on top so notes never appear below the hit position.
      ctx!.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx!.fillRect(0, receptorY - 1.5, w, 3);
      for (let c = 0; c < cols; c += 1) {
        const color = COLUMN_COLORS[c % COLUMN_COLORS.length]!;
        ctx!.fillStyle = color;
        ctx!.globalAlpha = 0.35;
        ctx!.fillRect(c * colW + gap, receptorY - 4, noteW, 8);
        ctx!.globalAlpha = 1;
      }

      // Dim the area under the receptor so past notes can't show through.
      ctx!.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx!.fillRect(0, receptorY + 1.5, w, h - receptorY);

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

export const PREVIEW_SCROLL_DEFAULT = DEFAULT_SCROLL_PX_PER_MS;
