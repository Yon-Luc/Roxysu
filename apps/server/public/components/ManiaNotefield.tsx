import { useEffect, useRef } from "react";
import type { BeatmapPreview } from "../lib/api";
import {
  resolveKeymodeSkin,
  usePreviewSkin,
  type ColumnSkin,
  type KeymodeSkin,
  type NoteShape,
} from "../lib/previewSkin";

const DEFAULT_SCROLL_PX_PER_MS = 0.55;
const RECEPTOR_Y_RATIO = 0.88;
const BASE_TAP_HEIGHT = 14;

type Note = BeatmapPreview["notes"][number];

type ManiaNotefieldProps = {
  columnCount: number;
  notes: Note[];
  /** Returns current playback time in milliseconds (read each frame). */
  getCurrentTimeMs: () => number;
  /** Pixels the notefield scrolls per millisecond. */
  scrollPxPerMs?: number;
  /** Override skin (e.g. live editor preview). Falls back to stored skin. */
  skinOverride?: KeymodeSkin;
  className?: string;
};

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

function drawFlat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y - h / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Down-pointing arrow (toward receptor). */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
) {
  const top = y - h / 2;
  const bottom = y + h / 2;
  const midX = x + w / 2;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(midX, bottom);
  ctx.lineTo(x + w, top + h * 0.35);
  ctx.lineTo(x + w * 0.68, top + h * 0.35);
  ctx.lineTo(x + w * 0.68, top);
  ctx.lineTo(x + w * 0.32, top);
  ctx.lineTo(x + w * 0.32, top + h * 0.35);
  ctx.lineTo(x, top + h * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTap(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
) {
  if (shape === "circle") {
    drawCircle(ctx, x + w / 2, y, w / 2, Math.max(h / 2, 4), color, alpha);
    return;
  }
  if (shape === "arrow") {
    drawArrow(ctx, x, y, w, h, color, alpha);
    return;
  }
  drawFlat(ctx, x, y, w, h, color, alpha);
}

function drawHoldBody(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  top: number,
  w: number,
  height: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  if (shape === "circle") {
    const r = w / 2;
    const bottom = top + height;
    // Capsule: semicircle top + rect + semicircle bottom (clipped later).
    ctx.beginPath();
    ctx.moveTo(x, top + r);
    ctx.arc(x + r, top + r, r, Math.PI, 0);
    ctx.lineTo(x + w, Math.max(top + r, bottom - r));
    ctx.arc(x + r, Math.max(top + r, bottom - r), r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, top, w, height);
  }
  ctx.globalAlpha = 1;
}

export function ManiaNotefield({
  columnCount,
  notes,
  getCurrentTimeMs,
  scrollPxPerMs = DEFAULT_SCROLL_PX_PER_MS,
  skinOverride,
  className = "",
}: ManiaNotefieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef<Note[]>([]);
  const columnsRef = useRef(columnCount);
  const getTimeRef = useRef(getCurrentTimeMs);
  const scrollRef = useRef(scrollPxPerMs);
  const storedSkin = usePreviewSkin();
  const keymodeSkin = skinOverride ?? resolveKeymodeSkin(storedSkin, columnCount);
  const skinRef = useRef(keymodeSkin);
  skinRef.current = keymodeSkin;

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

    function colSkin(col: number): ColumnSkin {
      const cols = skinRef.current.columns;
      return cols[col] ?? cols[col % Math.max(1, cols.length)] ?? {
        noteColor: "#a5b4fc",
        lnColor: "#a5b4fc",
        widthScale: 0.92,
        heightScale: 1,
      };
    }

    function draw() {
      if (!running) return;
      const cols = Math.max(1, columnsRef.current);
      const t = getTimeRef.current();
      const scroll = scrollRef.current;
      const noteList = notesRef.current;
      const shape = skinRef.current.shape;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const receptorY = h * RECEPTOR_Y_RATIO;
      const colW = w / cols;
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

      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, 0, w, receptorY);
      ctx!.clip();

      const windowStart = t;
      const windowEnd = t + lookaheadMs;
      const startIdx = Math.max(0, bisectLeft(noteList, windowStart - 8000) - 1);

      for (let i = startIdx; i < noteList.length; i += 1) {
        const note = noteList[i]!;
        if (note.startMs > windowEnd) break;
        if (note.endMs < windowStart) continue;

        const col = Math.min(cols - 1, Math.max(0, note.column));
        const skin = colSkin(col);
        const gap = Math.max(1, colW * (1 - skin.widthScale) * 0.5);
        const noteW = colW - gap * 2;
        const x = col * colW + gap;
        const tapH = BASE_TAP_HEIGHT * skin.heightScale;
        const isHold = note.endMs > note.startMs + 20;

        const startY = receptorY - (note.startMs - t) * scroll;
        if (isHold) {
          const endY = receptorY - (note.endMs - t) * scroll;
          const top = Math.min(startY, endY);
          const bottom = Math.max(startY, endY);
          const height = Math.max(tapH, bottom - top);
          drawHoldBody(ctx!, shape, x, top, noteW, height, skin.lnColor);
          if (note.startMs >= t) {
            drawTap(ctx!, shape, x, startY, noteW, tapH, skin.noteColor, 0.95);
          }
        } else if (note.startMs >= t) {
          drawTap(ctx!, shape, x, startY, noteW, tapH, skin.noteColor, 0.95);
        }
      }

      ctx!.restore();

      ctx!.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx!.fillRect(0, receptorY - 1.5, w, 3);
      for (let c = 0; c < cols; c += 1) {
        const skin = colSkin(c);
        const gap = Math.max(1, colW * (1 - skin.widthScale) * 0.5);
        const noteW = colW - gap * 2;
        ctx!.fillStyle = skin.noteColor;
        ctx!.globalAlpha = 0.35;
        ctx!.fillRect(c * colW + gap, receptorY - 4, noteW, 8);
        ctx!.globalAlpha = 1;
      }

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
