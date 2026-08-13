import type { BeatmapPreview } from "./api";
import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import { comboColorFor, type StdSkin } from "./stdSkin";

export type PaintContext2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const OSU_WIDTH = 512;
const OSU_HEIGHT = 384;

export type StdHitObject = NonNullable<BeatmapPreview["hitObjects"]>[number];

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
  kind?: "head" | "tick" | "tail";
  frac?: number;
};

export type CursorTrailPoint = { x: number; y: number; t: number };

const JUDGMENT_COLORS: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffe566",
  great: "#7dd3fc",
  good: "#86efac",
  ok: "#fdba74",
  meh: "#f9a8d4",
  miss: "#f87171",
};

const POPUP_LABEL: Record<ReplayJudgmentResult, string> = {
  perfect: "300",
  great: "300",
  good: "100",
  ok: "50",
  meh: "50",
  miss: "X",
};

const POPUP_COLOR: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffffff",
  great: "#ffffff",
  good: "#66ccff",
  ok: "#ff9966",
  meh: "#ff9966",
  miss: "#ff6666",
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

export function buildComboNumbers(objects: StdHitObject[]): number[] {
  const out = new Array<number>(objects.length).fill(0);
  let combo = 0;
  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]!;
    if (obj.type === "spinner") continue;
    combo += 1;
    out[i] = combo;
  }
  return out;
}

function pathPointAt(
  path: Array<{ x: number; y: number }>,
  frac: number,
): { x: number; y: number } | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0]!;
  const f = Math.min(1, Math.max(0, frac)) * (path.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(path.length - 1, i0 + 1);
  const u = f - i0;
  const a = path[i0]!;
  const b = path[i1]!;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

function bounceFracAt(u: number, repeats: number): number {
  const prog = Math.min(repeats, Math.max(0, u * repeats));
  const seg = Math.floor(prog);
  let local = prog - seg;
  if (seg % 2 === 1) local = 1 - local;
  return Math.min(1, Math.max(0, local));
}

export function buildHeadMap(judgments: StdPlayfieldJudgment[] | undefined): {
  head: Map<number, StdPlayfieldJudgment>;
  subs: Map<number, StdPlayfieldJudgment[]>;
} {
  const head = new Map<number, StdPlayfieldJudgment>();
  const subs = new Map<number, StdPlayfieldJudgment[]>();
  if (!judgments) return { head, subs };
  for (const j of judgments) {
    if (j.kind && j.kind !== "head") {
      const list = subs.get(j.noteIndex) ?? [];
      list.push(j);
      subs.set(j.noteIndex, list);
    } else if (!head.has(j.noteIndex)) {
      head.set(j.noteIndex, j);
    }
  }
  for (const list of subs.values()) {
    list.sort((a, b) => a.tMs - b.tMs);
  }
  return { head, subs };
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

function subListFor(
  subs: Map<number, StdPlayfieldJudgment[]>,
  index: number,
  kind: "tick" | "tail",
): StdPlayfieldJudgment | undefined {
  return (subs.get(index) ?? []).find((s) => s.kind === kind);
}

function playfieldTransform(w: number, h: number) {
  const scale = Math.min(w / OSU_WIDTH, h / OSU_HEIGHT);
  const ox = (w - OSU_WIDTH * scale) / 2;
  const oy = (h - OSU_HEIGHT * scale) / 2;
  return { scale, ox, oy };
}

export type PaintStdPlayfieldArgs = {
  ctx: PaintContext2D;
  /** CSS-pixel width of the drawing surface (after any DPR transform). */
  width: number;
  /** CSS-pixel height of the drawing surface. */
  height: number;
  tMs: number;
  hitObjects: StdHitObject[];
  circleSize: number;
  approachRate: number;
  frames?: StdPlayfieldFrame[];
  judgments?: StdPlayfieldJudgment[];
  hidden?: boolean;
  skin?: StdSkin | null;
  /**
   * Mutable cursor trail. When provided, advanced for this frame (sequential
   * encode). When omitted, trail is rebuilt from frames for the last 180ms.
   */
  trail?: CursorTrailPoint[];
  /** Precomputed combo numbers; built if omitted. */
  comboNumbers?: number[];
  /** Precomputed head/sub judgment maps; built if omitted. */
  judgmentMaps?: ReturnType<typeof buildHeadMap>;
};

/** Paint one standard playfield frame at `tMs`. */
export function paintStdPlayfield(args: PaintStdPlayfieldArgs): void {
  const {
    ctx,
    width: w,
    height: h,
    tMs: t,
    hitObjects: objs,
    circleSize: cs,
    approachRate: ar,
    frames = [],
    judgments,
    hidden = false,
    skin = null,
  } = args;

  const preempt = approachPreemptMs(ar);
  const fadeIn = approachFadeInMs(ar);
  const { scale, ox, oy } = playfieldTransform(w, h);
  const { head, subs } = args.judgmentMaps ?? buildHeadMap(judgments);
  const combos = args.comboNumbers ?? buildComboNumbers(objs);
  const comboColors = skin ?? undefined;
  const radius =
    circleRadius(cs) *
    (comboColors?.hitCircleScale != null ? comboColors.hitCircleScale : 1);

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(ox, oy, OSU_WIDTH * scale, OSU_HEIGHT * scale);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    ox + 0.5,
    oy + 0.5,
    OSU_WIDTH * scale - 1,
    OSU_HEIGHT * scale - 1,
  );

  const toScreen = (x: number, y: number) => ({
    sx: ox + x * scale,
    sy: oy + y * scale,
  });
  const comboColor = (i: number) =>
    comboColors ? comboColorFor(comboColors, combos[i] ?? 1) : "#c4b5fd";

  const startIdx = Math.max(0, bisectLeft(objs, t - 2000) - 2);
  const visible: Array<{ obj: StdHitObject; index: number }> = [];
  for (let i = startIdx; i < objs.length; i += 1) {
    const obj = objs[i]!;
    if (obj.timeMs - preempt > t + 50) break;
    const end = objectEndMs(obj);
    const judgment = head.get(i);
    const linger = Math.max(200, preempt * 0.15);
    const hideAfter =
      obj.type === "slider" || obj.type === "spinner"
        ? end + linger
        : judgment != null
          ? judgment.tMs + (judgment.result === "miss" ? 200 : 120)
          : end + linger;
    if (t > hideAfter) continue;
    visible.push({ obj, index: i });
  }

  for (const { obj, index } of visible) {
    const judgment = head.get(index);
    const judged = judgment != null && t >= judgment.tMs - 1;
    const alphaFromApproach = (() => {
      const appear = obj.timeMs - preempt;
      if (t < appear) return 0;
      if (t < appear + fadeIn) return (t - appear) / fadeIn;
      return 1;
    })();
    const hiddenAlpha = (() => {
      if (!hidden || obj.type === "spinner") return 1;
      const disappearStart = obj.timeMs - preempt * 0.6;
      if (t <= disappearStart) return 1;
      const u = (t - disappearStart) / (preempt * 0.4);
      return Math.max(0, 1 - u);
    })();
    const baseAlpha = Math.min(1, alphaFromApproach) * hiddenAlpha;

    if (obj.type === "spinner") {
      const progress = Math.min(
        1,
        Math.max(0, (t - obj.timeMs) / Math.max(1, obj.endMs - obj.timeMs)),
      );
      const { sx, sy } = toScreen(OSU_WIDTH / 2, OSU_HEIGHT / 2);
      const r = Math.min(OSU_WIDTH, OSU_HEIGHT) * 0.35 * scale;
      const spinnerColor = comboColors?.spinner ?? "#fbbf24";
      ctx.globalAlpha = Math.min(1, baseAlpha);
      ctx.strokeStyle = judged
        ? JUDGMENT_COLORS[judgment!.result]
        : spinnerColor;
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = spinnerColor;
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }

    const hx = obj.stackX;
    const hy = obj.stackY;
    const { sx, sy } = toScreen(hx, hy);
    const r = radius * scale;
    const fillColor = comboColor(index);
    const isSlider = obj.type === "slider";

    if (isSlider && obj.path.length > 1) {
      const trackColor =
        comboColors?.sliderTrack ?? "rgba(165, 180, 252, 0.85)";
      const fill = comboColors?.sliderFill ?? "rgba(30, 30, 40, 0.9)";
      ctx.globalAlpha = Math.min(0.85, baseAlpha);
      ctx.strokeStyle = trackColor;
      ctx.lineWidth = r * 1.7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let p = 0; p < obj.path.length; p += 1) {
        const pt = obj.path[p]!;
        const sp = toScreen(pt.x, pt.y);
        if (p === 0) ctx.moveTo(sp.sx, sp.sy);
        else ctx.lineTo(sp.sx, sp.sy);
      }
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = r * 1.15;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (comboColors?.showSliderTicks !== false) {
        const subList = subs.get(index) ?? [];
        ctx.lineWidth = Math.max(1, 2 * scale);
        for (const tick of obj.ticks ?? []) {
          const pt = pathPointAt(obj.path, tick.frac);
          if (!pt) continue;
          const sp = toScreen(pt.x, pt.y);
          const tickJ = subList.find(
            (s) =>
              s.kind === "tick" &&
              s.frac != null &&
              Math.abs(s.frac - tick.frac) < 1e-4,
          );
          let color = "rgba(255,255,255,0.5)";
          if (tickJ && t >= tickJ.tMs) {
            color =
              tickJ.result === "miss" ? "rgba(248,113,113,0.8)" : fillColor;
          }
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(sp.sx, sp.sy, Math.max(2, r * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (
        comboColors?.showFollowCircle !== false &&
        judged &&
        t >= obj.timeMs &&
        t <= obj.endMs
      ) {
        const followR = r * 2.2;
        ctx.fillStyle = fillColor;
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.arc(sx, sy, followR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (t >= obj.timeMs && t <= obj.endMs) {
        const totalSpan = Math.max(1, obj.endMs - obj.timeMs);
        const uFrac = (t - obj.timeMs) / totalSpan;
        const ballFrac = bounceFracAt(uFrac, Math.max(1, obj.repeats));
        const ball = pathPointAt(obj.path, ballFrac);
        if (ball) {
          const bp = toScreen(ball.x, ball.y);
          ctx.fillStyle = comboColors?.sliderBall ?? "#fbbf24";
          ctx.globalAlpha = Math.min(1, baseAlpha);
          ctx.beginPath();
          ctx.arc(bp.sx, bp.sy, r * 0.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (judged) {
        const tailJ = subListFor(subs, index, "tail");
        if (tailJ && t >= tailJ.tMs && t <= tailJ.tMs + 150) {
          const tailPoint = pathPointAt(
            obj.path,
            obj.repeats % 2 === 1 ? 1 : 0,
          );
          if (tailPoint) {
            const tp = toScreen(tailPoint.x, tailPoint.y);
            ctx.globalAlpha = Math.max(0, 1 - (t - tailJ.tMs) / 150);
            ctx.fillStyle = JUDGMENT_COLORS[tailJ.result];
            ctx.beginPath();
            ctx.arc(tp.sx, tp.sy, r * 0.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    if (!judged && t < obj.timeMs) {
      const remain = (obj.timeMs - t) / preempt;
      const approachR = r * (1 + 3 * Math.max(0, remain));
      ctx.globalAlpha = Math.min(1, baseAlpha);
      ctx.strokeStyle = comboColors?.approach ?? "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, approachR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = judged
      ? Math.max(0, 1 - (t - (judgment?.tMs ?? t)) / 150)
      : Math.min(1, baseAlpha);
    ctx.fillStyle =
      judged && judgment ? JUDGMENT_COLORS[judgment.result] : fillColor;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (comboColors?.showComboNumbers !== false && !judged) {
      const combo = combos[index] ?? 0;
      if (combo > 0) {
        ctx.globalAlpha = Math.min(1, baseAlpha);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.max(10, r * 0.78)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(combo), sx, sy + r * 0.04);
        ctx.globalAlpha = 1;
      }
    }

    if (comboColors?.showHitPopups !== false && judgment) {
      const age = t - judgment.tMs;
      if (age >= 0 && age < 400) {
        const rise = (age / 400) * 34;
        ctx.globalAlpha = Math.max(0, 1 - age / 400);
        ctx.fillStyle = POPUP_COLOR[judgment.result];
        ctx.font = `bold ${Math.max(12, r * 0.9)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(POPUP_LABEL[judgment.result], sx, sy - rise - r * 0.4);
        ctx.globalAlpha = 1;
      }
    }
  }

  const cursor = interpolateCursor(frames, t);
  if (cursor) {
    let trail = args.trail;
    if (trail) {
      trail.push({ x: cursor.x, y: cursor.y, t });
      while (trail.length > 0 && t - trail[0]!.t > 180) trail.shift();
      if (trail.length > 40) trail.splice(0, trail.length - 40);
    } else {
      trail = rebuildTrail(frames, t);
    }

    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = comboColors?.trail ?? "rgba(255,255,255,0.25)";
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 1) {
      const p = toScreen(trail[i]!.x, trail[i]!.y);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();

    const cp = toScreen(cursor.x, cursor.y);
    const clicking =
      (cursor.buttons & 1) !== 0 || (cursor.buttons & 2) !== 0;
    ctx.fillStyle = clicking
      ? "rgba(251, 191, 36, 0.95)"
      : (comboColors?.cursor ?? "rgba(255,255,255,0.9)");
    ctx.beginPath();
    ctx.arc(cp.sx, cp.sy, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  }
}

function rebuildTrail(
  frames: StdPlayfieldFrame[],
  t: number,
): CursorTrailPoint[] {
  const out: CursorTrailPoint[] = [];
  const start = t - 180;
  for (const f of frames) {
    if (f.tMs < start) continue;
    if (f.tMs > t) break;
    out.push({ x: f.x, y: f.y, t: f.tMs });
  }
  const cursor = interpolateCursor(frames, t);
  if (cursor && (out.length === 0 || out[out.length - 1]!.t < t - 0.5)) {
    out.push({ x: cursor.x, y: cursor.y, t });
  }
  if (out.length > 40) return out.slice(out.length - 40);
  return out;
}
