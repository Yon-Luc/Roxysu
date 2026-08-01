import { useEffect, useRef } from "react";
import type { BeatmapPreview } from "../lib/api";
import {
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  orientationDegrees,
  resolveKeymodeSkin,
  usePreviewSkin,
  type ColumnSkin,
  type KeymodeSkin,
  type LnTailShape,
  type NoteOrientation,
  type NoteShape,
} from "../lib/previewSkin";

/** osu!lazer mania: timeRangeMs = MAX_TIME_RANGE / scrollSpeed (speed 1–40). */
const OSU_MAX_TIME_RANGE_MS = 11485;
const PREVIEW_SCROLL_MIN = 1;
const PREVIEW_SCROLL_MAX = 40;
const PREVIEW_SCROLL_DEFAULT = 20;
const BASE_TAP_HEIGHT = 14;
/** Max fraction of column width used for circle/arrow noteheads. */
const SHAPED_WIDTH_CAP = 0.85;

type Note = BeatmapPreview["notes"][number];

export type ReplayJudgmentResult =
  | "perfect"
  | "great"
  | "good"
  | "ok"
  | "meh"
  | "miss";

export type NotefieldJudgment = {
  noteIndex: number;
  tMs: number;
  result: ReplayJudgmentResult;
  /** Hit offset in ms (press−start or release−end); null on miss. */
  errorMs?: number | null;
  isTail?: boolean;
};

export type NotefieldFrame = {
  tMs: number;
  keys: number;
};

type ManiaNotefieldProps = {
  columnCount: number;
  notes: Note[];
  /** Returns current playback time in milliseconds (read each frame). */
  getCurrentTimeMs: () => number;
  /**
   * osu!mania scroll speed (1–40). Notes take
   * `11485 / scrollSpeed` ms to travel top → receptor.
   */
  scrollSpeed?: number;
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

const JUDGMENT_COLORS: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffe566",
  great: "#7dd3fc",
  good: "#86efac",
  ok: "#fdba74",
  meh: "#f9a8d4",
  miss: "#f87171",
};

/** Desaturated note color used in analysis mode. */
const ANALYSIS_NOTE_GREY = "#9ca3af";

type NoteGeom = {
  x: number;
  noteW: number;
  tapH: number;
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

function bisectFrame(frames: NotefieldFrame[], timeMs: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Column-centered note geometry; circle/arrow use square noteheads. */
function noteGeom(
  shape: NoteShape,
  col: number,
  colW: number,
  skin: ColumnSkin,
): NoteGeom {
  if (shape === "flat") {
    const gap = Math.max(1, colW * (1 - skin.widthScale) * 0.5);
    const noteW = colW - gap * 2;
    return {
      x: col * colW + gap,
      noteW,
      tapH: BASE_TAP_HEIGHT * skin.heightScale,
    };
  }

  const baseW = Math.min(colW * skin.widthScale, colW * SHAPED_WIDTH_CAP);
  const size = Math.max(8, Math.min(baseW * skin.heightScale, colW * 0.95));
  return {
    x: col * colW + (colW - size) / 2,
    noteW: size,
    tapH: size,
  };
}

function strokeOutline(
  ctx: CanvasRenderingContext2D,
  alpha: number,
  lineWidth = 1.5,
) {
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;
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
  r: number,
  color: string,
  alpha: number,
) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  strokeOutline(ctx, alpha);
  // Soft inner highlight for depth.
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.22, cy - r * 0.22, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Build a down-pointing arrow path (tip toward receptor). */
function arrowPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const top = y - h / 2;
  const bottom = y + h / 2;
  const midX = x + w / 2;
  // Wider head, shorter shaft — closer to square VSRG noteheads.
  const headTop = top + h * 0.42;
  const shaftW = w * 0.34;
  const shaftLeft = midX - shaftW / 2;
  const shaftRight = midX + shaftW / 2;
  ctx.beginPath();
  ctx.moveTo(midX, bottom);
  ctx.lineTo(x + w, headTop);
  ctx.lineTo(shaftRight, headTop);
  ctx.lineTo(shaftRight, top);
  ctx.lineTo(shaftLeft, top);
  ctx.lineTo(shaftLeft, headTop);
  ctx.lineTo(x, headTop);
  ctx.closePath();
}

function withOrientation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: NoteOrientation,
  draw: () => void,
) {
  const deg = orientationDegrees(orientation);
  if (deg === 0) {
    draw();
    return;
  }
  const cx = x + w / 2;
  const cy = y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

/** Oriented arrow (default tip toward receptor / down). */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
  orientation: NoteOrientation = "down",
) {
  withOrientation(ctx, x, y, w, h, orientation, () => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    arrowPath(ctx, x, y, w, h);
    ctx.fill();
    strokeOutline(ctx, alpha);
    ctx.globalAlpha = 1;
  });
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
  orientation: NoteOrientation = "down",
) {
  if (shape === "circle") {
    const r = Math.min(w, h) / 2;
    drawCircle(ctx, x + w / 2, y, r, color, alpha);
    return;
  }
  if (shape === "arrow") {
    drawArrow(ctx, x, y, w, h, color, alpha, orientation);
    return;
  }
  drawFlat(ctx, x, y, w, h, color, alpha);
}

/** Horizontal line at the map-time press position (judgment color). */
function drawPressMarkerLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  pressY: number,
  result: ReplayJudgmentResult,
) {
  const h = 4;
  ctx.save();
  ctx.fillStyle = JUDGMENT_COLORS[result];
  ctx.globalAlpha = 1;
  ctx.fillRect(x, pressY - h / 2, w, h);
  ctx.restore();
}

/** Analysis miss marker — rectangle frame around the note (keeps skin color). */
function drawMissRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const pad = 4;
  ctx.save();
  ctx.strokeStyle = JUDGMENT_COLORS.miss;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 1;
  ctx.strokeRect(x - pad, y - h / 2 - pad, w + pad * 2, h + pad * 2);
  ctx.restore();
}

/** Rectangle around an LN body (head → tail span). */
function drawMissHoldRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  height: number,
) {
  const pad = 4;
  ctx.save();
  ctx.strokeStyle = JUDGMENT_COLORS.miss;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 1;
  ctx.strokeRect(x - pad, top - pad, w + pad * 2, height + pad * 2);
  ctx.restore();
}

function drawHoldBody(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  top: number,
  w: number,
  height: number,
  color: string,
  lnBodyScale = 0.6,
  lnTailShape: LnTailShape = "pointed",
) {
  const bodyW = w * lnBodyScale;
  const bodyX = x + (w - bodyW) / 2;
  const bottom = top + height;
  const midX = bodyX + bodyW / 2;

  // Cap height for pointed/rounded ends (clamped so short holds still look ok).
  const tipH =
    lnTailShape === "flat"
      ? 0
      : Math.min(bodyW * 0.55, Math.max(6, height * 0.28), height * 0.45);
  const bodyTop = top + tipH;

  ctx.fillStyle = color;
  ctx.globalAlpha = shape === "flat" ? 0.55 : 0.6;

  if (lnTailShape === "pointed" && tipH > 0) {
    // House / chevron tip at the far end (away from receptor), matching
    // common arrow skins — tip always points "up" the timeline.
    ctx.beginPath();
    ctx.moveTo(midX, top);
    ctx.lineTo(bodyX + bodyW, bodyTop);
    ctx.lineTo(bodyX + bodyW, bottom);
    ctx.lineTo(bodyX, bottom);
    ctx.lineTo(bodyX, bodyTop);
    ctx.closePath();
    ctx.fill();
  } else if (lnTailShape === "rounded" && tipH > 0) {
    const r = Math.min(bodyW / 2, tipH);
    ctx.beginPath();
    ctx.moveTo(bodyX, bottom);
    ctx.lineTo(bodyX + bodyW, bottom);
    ctx.lineTo(bodyX + bodyW, bodyTop + (tipH - r));
    ctx.arc(midX, bodyTop + (tipH - r), r, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "circle") {
    const r = bodyW / 2;
    const cyTop = top + r;
    const cyBot = Math.max(cyTop, bottom - r);
    ctx.beginPath();
    ctx.moveTo(bodyX, cyTop);
    ctx.arc(midX, cyTop, r, Math.PI, 0);
    ctx.lineTo(bodyX + bodyW, cyBot);
    ctx.arc(midX, cyBot, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(bodyX, top, bodyW, height);
  }

  ctx.globalAlpha = 1;
}

function drawReceptor(
  ctx: CanvasRenderingContext2D,
  shape: NoteShape,
  x: number,
  receptorY: number,
  noteW: number,
  tapH: number,
  color: string,
  held: boolean,
  orientation: NoteOrientation = "down",
) {
  const alpha = held ? 0.95 : 0.35;
  const fill = held ? "#ffffff" : color;

  if (shape === "flat") {
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, receptorY - (held ? 6 : 4), noteW, held ? 12 : 8);
    ctx.globalAlpha = 1;
    return;
  }

  if (shape === "circle") {
    const r = Math.min(noteW, tapH) / 2;
    const cx = x + noteW / 2;
    ctx.globalAlpha = alpha;
    if (held) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, receptorY, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = fill;
    ctx.lineWidth = held ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, receptorY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  // Arrow receptor: outline matching note silhouette + orientation.
  withOrientation(ctx, x, receptorY, noteW, tapH, orientation, () => {
    ctx.globalAlpha = alpha;
    if (held) {
      ctx.fillStyle = fill;
      arrowPath(ctx, x, receptorY, noteW, tapH);
      ctx.fill();
    }
    ctx.strokeStyle = fill;
    ctx.lineWidth = held ? 2.5 : 1.75;
    arrowPath(ctx, x, receptorY, noteW, tapH);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function buildHeadJudgmentMap(
  judgments: NotefieldJudgment[] | undefined,
): Map<number, NotefieldJudgment> {
  const map = new Map<number, NotefieldJudgment>();
  if (!judgments) return map;
  for (const j of judgments) {
    if (j.isTail) continue;
    if (!map.has(j.noteIndex)) map.set(j.noteIndex, j);
  }
  return map;
}

function clampScrollSpeed(speed: number): number {
  return Math.min(
    PREVIEW_SCROLL_MAX,
    Math.max(PREVIEW_SCROLL_MIN, speed),
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Convert legacy px/ms prefs (≤2) to an approximate osu scroll speed. */
export function migratePreviewScroll(raw: number): number {
  if (!Number.isFinite(raw)) return PREVIEW_SCROLL_DEFAULT;
  if (raw > 2) return clampScrollSpeed(raw);
  const refReceptorY = 500;
  return clampScrollSpeed(
    Math.round((OSU_MAX_TIME_RANGE_MS * raw) / refReceptorY),
  );
}

export function ManiaNotefield({
  columnCount,
  notes,
  getCurrentTimeMs,
  scrollSpeed = PREVIEW_SCROLL_DEFAULT,
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

    function colSkin(col: number): ColumnSkin {
      const cols = skinRef.current.columns;
      return cols[col] ?? cols[col % Math.max(1, cols.length)] ?? {
        noteColor: "#a5b4fc",
        lnColor: "#a5b4fc",
        widthScale: 0.92,
        heightScale: 1,
        orientation: "down",
        lnBodyScale: 0.6,
      };
    }

    function draw() {
      if (!running) return;
      const cols = Math.max(1, columnsRef.current);
      const t = getTimeRef.current();
      const noteList = notesRef.current;
      const shape = skinRef.current.shape;
      const frameList = framesRef.current;
      const headMap = headJudgmentsRef.current;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      const hitPosition = hitPositionRef.current;
      const receptorY = h * hitPosition;
      // Cover may not reach the receptor — leave a small gap so the hit line stays visible.
      const coverH = Math.min(
        h * laneCoverRef.current,
        Math.max(0, receptorY - 12),
      );
      const timeRangeMs =
        OSU_MAX_TIME_RANGE_MS / scrollSpeedRef.current;
      const scroll = Math.max(0.05, receptorY / timeRangeMs);
      const colW = w / cols;
      const lookaheadMs = timeRangeMs + 200;

      const frameIdx = frameList.length > 0 ? bisectFrame(frameList, t) : -1;
      const liveMask = liveHeldMaskRef.current;
      const keys =
        liveMask != null
          ? liveMask
          : frameIdx >= 0
            ? frameList[frameIdx]!.keys
            : 0;

      ctx!.clearRect(0, 0, w, h);

      ctx!.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx!.fillRect(0, 0, w, h);

      ctx!.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx!.lineWidth = 1;
      for (let c = 1; c < cols; c += 1) {
        const x = c * colW;
        ctx!.beginPath();
        ctx!.moveTo(x, coverH);
        ctx!.lineTo(x, h);
        ctx!.stroke();
      }

      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, coverH, w, Math.max(0, receptorY - coverH));
      ctx!.clip();

      const windowStart = t;
      const windowEnd = t + lookaheadMs;
      const startIdx = Math.max(0, bisectLeft(noteList, windowStart - 8000) - 1);
      const markMisses = highlightMissRef.current;

      for (let i = startIdx; i < noteList.length; i += 1) {
        const note = noteList[i]!;
        if (note.startMs > windowEnd) break;

        const col = Math.min(cols - 1, Math.max(0, note.column));
        const skin = colSkin(col);
        const { x, noteW, tapH } = noteGeom(shape, col, colW, skin);
        const isHold = note.endMs > note.startMs + 20;

        const judgment = headMap.get(i);
        const hasJudgment = judgment != null;
        const isMiss = judgment?.result === "miss";
        const judged = hasJudgment && t >= judgment.tMs;
        const judgmentColor =
          judgment != null ? JUDGMENT_COLORS[judgment.result] : skin.noteColor;
        const useJudgmentColor =
          judged && !isHold && !markMisses && !isMiss;
        const showPressMarker =
          markMisses &&
          hasJudgment &&
          !isMiss &&
          judgment!.errorMs != null;
        const noteColor = useJudgmentColor
          ? judgmentColor
          : skin.noteColor;
        const lnColor = skin.lnColor;
        const displayNoteColor = markMisses ? ANALYSIS_NOTE_GREY : noteColor;
        const displayLnColor = markMisses ? ANALYSIS_NOTE_GREY : lnColor;
        const alpha =
          judged && isMiss && !markMisses ? 0.35 : 0.95;

        const startY = receptorY - (note.startMs - t) * scroll;
        const headOnScreen =
          startY + tapH / 2 >= coverH && startY - tapH / 2 <= receptorY;
        const pressY =
          hasJudgment && !isMiss
            ? receptorY - (judgment!.tMs - t) * scroll
            : 0;
        const pressMarkerOnScreen =
          showPressMarker &&
          pressY >= coverH &&
          pressY <= receptorY;

        if (note.endMs < windowStart) {
          if (!(markMisses && hasJudgment && headOnScreen)) continue;
        }

        if (isHold) {
          const endY = receptorY - (note.endMs - t) * scroll;
          const top = Math.min(startY, endY);
          const bottom = Math.max(startY, endY);
          const height = Math.max(tapH, bottom - top);
          const showHead = skinRef.current.lnShowHead;
          drawHoldBody(
            ctx!,
            shape,
            x,
            top,
            noteW,
            height,
            displayLnColor,
            skin.lnBodyScale,
            skinRef.current.lnTailShape,
          );
          if (showHead && (headOnScreen || note.startMs >= t)) {
            drawTap(
              ctx!,
              shape,
              x,
              startY,
              noteW,
              tapH,
              displayNoteColor,
              alpha,
              skin.orientation,
            );
          }
          if (showPressMarker && (headOnScreen || pressMarkerOnScreen)) {
            drawPressMarkerLine(
              ctx!,
              x,
              noteW,
              pressY,
              judgment!.result,
            );
          }
          if (markMisses && isMiss && hasJudgment) {
            drawMissHoldRect(ctx!, x, top, noteW, height);
          }
        } else if (markMisses && hasJudgment && headOnScreen) {
          drawTap(
            ctx!,
            shape,
            x,
            startY,
            noteW,
            tapH,
            displayNoteColor,
            alpha,
            skin.orientation,
          );
          if (isMiss) {
            drawMissRect(ctx!, x, startY, noteW, tapH);
          } else if (showPressMarker && (headOnScreen || pressMarkerOnScreen)) {
            drawPressMarkerLine(
              ctx!,
              x,
              noteW,
              pressY,
              judgment!.result,
            );
          }
        } else if (note.startMs >= t) {
          drawTap(
            ctx!,
            shape,
            x,
            startY,
            noteW,
            tapH,
            displayNoteColor,
            alpha,
            skin.orientation,
          );
        } else if (!markMisses && judged && t - judgment.tMs < 120) {
          // Brief flash at receptor after hit.
          const flashY = receptorY;
          const flashAlpha = 1 - (t - judgment.tMs) / 120;
          const flashScale = 1.15;
          const fw = noteW * flashScale;
          const fh = tapH * flashScale;
          drawTap(
            ctx!,
            shape,
            x + (noteW - fw) / 2,
            flashY,
            fw,
            fh,
            noteColor,
            flashAlpha,
            skin.orientation,
          );
        }
      }

      ctx!.restore();

      ctx!.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx!.fillRect(0, receptorY - 1.5, w, 3);
      for (let c = 0; c < cols; c += 1) {
        const skin = colSkin(c);
        const { x, noteW, tapH } = noteGeom(shape, c, colW, skin);
        const held = (keys & (1 << c)) !== 0;
        drawReceptor(
          ctx!,
          shape,
          x,
          receptorY,
          noteW,
          tapH,
          skin.noteColor,
          held,
          skin.orientation,
        );
      }

      ctx!.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx!.fillRect(0, receptorY + 1.5, w, h - receptorY);

      // Solid black lane cover — hides the top of the playfield.
      if (coverH > 0) {
        ctx!.fillStyle = "#000000";
        ctx!.fillRect(0, 0, w, coverH);
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
      className={`block h-full w-full ${className}`}
      aria-hidden
    />
  );
}

export {
  JUDGMENT_COLORS,
  PREVIEW_SCROLL_DEFAULT,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_MIN,
};
