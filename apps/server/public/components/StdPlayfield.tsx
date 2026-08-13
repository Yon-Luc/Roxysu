import { useEffect, useRef } from "react";
import type { BeatmapPreview, ScoreReplay } from "../lib/api";
import { comboColorFor, type StdSkin } from "../lib/stdSkin";
import type { ReplayJudgmentResult } from "./ManiaNotefield";

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
  /** Slider sub-part this entry describes. */
  kind?: "head" | "tick" | "tail";
  /** Path fraction for tick entries (0 = head, 1 = tail). */
  frac?: number;
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
  /** Hidden (HD) mod — circles/approaches fade out before the hit time. */
  hidden?: boolean;
  /** Standard playfield skin. */
  skin?: StdSkin;
  className?: string;
};

/** Flash + popup colors for playback judgments (standard hues). */
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

/** Combo number per object (osu! shows a static number per hit circle / slider head). */
function buildComboNumbers(objects: StdHitObject[]): number[] {
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

/** Ball path point at fractional position along the path. */
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

/** Ball path fraction at time fraction `u` of the whole slider (bounces on repeats). */
function bounceFracAt(u: number, repeats: number): number {
  const prog = Math.min(repeats, Math.max(0, u * repeats));
  const seg = Math.floor(prog);
  let local = prog - seg;
  if (seg % 2 === 1) local = 1 - local;
  return Math.min(1, Math.max(0, local));
}

function buildHeadMap(
  judgments: StdPlayfieldJudgment[] | undefined,
): { head: Map<number, StdPlayfieldJudgment>; subs: Map<number, StdPlayfieldJudgment[]> } {
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
  hidden = false,
  skin,
  className = "",
}: StdPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<StdHitObject[]>([]);
  const getTimeRef = useRef(getCurrentTimeMs);
  const framesRef = useRef<StdPlayfieldFrame[]>([]);
  const judgmentsRef = useRef<{ head: Map<number, StdPlayfieldJudgment>; subs: Map<number, StdPlayfieldJudgment[]> }>({
    head: new Map(),
    subs: new Map(),
  });
  const comboRef = useRef<number[]>([]);
  const csRef = useRef(circleSize);
  const arRef = useRef(approachRate);
  const hiddenRef = useRef(hidden);
  const skinRef = useRef(skin ?? null);
  const trailRef = useRef<Array<{ x: number; y: number; t: number }>>([]);

  objectsRef.current = hitObjects;
  getTimeRef.current = getCurrentTimeMs;
  framesRef.current = frames ?? [];
  judgmentsRef.current = buildHeadMap(judgments);
  comboRef.current = buildComboNumbers(hitObjects);
  csRef.current = circleSize;
  arRef.current = approachRate;
  hiddenRef.current = hidden;
  skinRef.current = skin ?? null;

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
      const { scale, ox, oy } = playfieldTransform(w, h);
      const { head, subs } = judgmentsRef.current;
      const frameList = framesRef.current;
      const combos = comboRef.current;
      const isHidden = hiddenRef.current;
      const activeSkin: StdSkin | null = skinRef.current;
      const comboColors = activeSkin ?? undefined;
      const radius =
        circleRadius(cs) *
        (comboColors?.hitCircleScale != null ? comboColors.hitCircleScale : 1);

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
      const comboColor = (i: number) =>
        comboColors ? comboColorFor(comboColors, combos[i] ?? 1) : "#c4b5fd";

      // Visible window: objects whose approach has started and not long past.
      const startIdx = Math.max(0, bisectLeft(objs, t - 2000) - 2);
      const visible: Array<{ obj: StdHitObject; index: number }> = [];
      for (let i = startIdx; i < objs.length; i += 1) {
        const obj = objs[i]!;
        if (obj.timeMs - preempt > t + 50) break;
        const end = objectEndMs(obj);
        const judgment = head.get(i);
        const linger = Math.max(200, preempt * 0.15);
        // Sliders/spinners stay until they complete — a head hit must not
        // despawn the body, ticks, or ball.
        const hideAfter =
          obj.type === "slider" || obj.type === "spinner"
            ? end + linger
            : judgment != null
              ? judgment.tMs + (judgment.result === "miss" ? 200 : 120)
              : end + linger;
        if (t > hideAfter) continue;
        visible.push({ obj, index: i });
      }

      // Draw earliest first so later objects sit on top.
      for (const { obj, index } of visible) {
        const judgment = head.get(index);
        const judged = judgment != null && t >= judgment.tMs - 1;
        const alphaFromApproach = (() => {
          const appear = obj.timeMs - preempt;
          if (t < appear) return 0;
          if (t < appear + fadeIn) return (t - appear) / fadeIn;
          return 1;
        })();
        // Hidden: dim toward 0 across the final 40% of the preempt.
        const hiddenAlpha = (() => {
          if (!isHidden || obj.type === "spinner") return 1;
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
          ctx!.globalAlpha = Math.min(1, baseAlpha);
          ctx!.strokeStyle = judged
            ? JUDGMENT_COLORS[judgment!.result]
            : spinnerColor;
          ctx!.lineWidth = 4 * scale;
          ctx!.beginPath();
          ctx!.arc(sx, sy, r, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.beginPath();
          ctx!.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx!.strokeStyle = spinnerColor;
          ctx!.stroke();
          ctx!.globalAlpha = 1;
          continue;
        }

        const hx = obj.stackX;
        const hy = obj.stackY;
        const { sx, sy } = toScreen(hx, hy);
        const r = radius * scale;
        const fillColor = comboColor(index);
        const isSlider = obj.type === "slider";

        if (isSlider && obj.path.length > 1) {
          const trackColor = comboColors?.sliderTrack ?? "rgba(165, 180, 252, 0.85)";
          const fill = comboColors?.sliderFill ?? "rgba(30, 30, 40, 0.9)";
          ctx!.globalAlpha = Math.min(0.85, baseAlpha);
          ctx!.strokeStyle = trackColor;
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
          ctx!.strokeStyle = fill;
          ctx!.lineWidth = r * 1.15;
          ctx!.stroke();
          ctx!.globalAlpha = 1;

          // Slider ticks along the path (before the ball so the ball draws on top).
          if (comboColors?.showSliderTicks !== false) {
            const subList = subs.get(index) ?? [];
            ctx!.lineWidth = Math.max(1, 2 * scale);
            for (const tick of obj.ticks ?? []) {
              const pt = pathPointAt(obj.path, tick.frac);
              if (!pt) continue;
              const sp = toScreen(pt.x, pt.y);
              const tickJ = subList.find((s) => s.kind === "tick" && s.frac != null && Math.abs(s.frac - tick.frac) < 1e-4);
              let color = "rgba(255,255,255,0.5)";
              if (tickJ && t >= tickJ.tMs) {
                color = tickJ.result === "miss" ? "rgba(248,113,113,0.8)" : fillColor;
              }
              ctx!.fillStyle = color;
              ctx!.beginPath();
              ctx!.arc(sp.sx, sp.sy, Math.max(2, r * 0.2), 0, Math.PI * 2);
              ctx!.fill();
            }
          }

          // Follow circle around the slider while the head is in play.
          if (comboColors?.showFollowCircle !== false && judged && t >= obj.timeMs && t <= obj.endMs) {
            const followR = r * 2.2;
            ctx!.fillStyle = fillColor;
            ctx!.globalAlpha = 0.08;
            ctx!.beginPath();
            ctx!.arc(sx, sy, followR, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.globalAlpha = 0.2;
            ctx!.strokeStyle = fillColor;
            ctx!.lineWidth = 2 * scale;
            ctx!.stroke();
            ctx!.globalAlpha = 1;
          }

          // Slider ball along path while active (distance-interpolated, bounce-aware).
          if (t >= obj.timeMs && t <= obj.endMs) {
            const totalSpan = Math.max(1, obj.endMs - obj.timeMs);
            const uFrac = (t - obj.timeMs) / totalSpan;
            const ballFrac = bounceFracAt(uFrac, Math.max(1, obj.repeats));
            const ball = pathPointAt(obj.path, ballFrac);
            if (ball) {
              const bp = toScreen(ball.x, ball.y);
              ctx!.fillStyle = comboColors?.sliderBall ?? "#fbbf24";
              ctx!.globalAlpha = Math.min(1, baseAlpha);
              ctx!.beginPath();
              ctx!.arc(bp.sx, bp.sy, r * 0.85, 0, Math.PI * 2);
              ctx!.fill();
              ctx!.globalAlpha = 1;
            }
          }

          // Tail flash when the tail judgment fires.
          if (judged) {
            const tailJ = subListFor(subs, index, "tail");
            if (tailJ && t >= tailJ.tMs && t <= tailJ.tMs + 150) {
              const tailPoint = pathPointAt(
                obj.path,
                obj.repeats % 2 === 1 ? 1 : 0,
              );
              if (tailPoint) {
                const tp = toScreen(tailPoint.x, tailPoint.y);
                ctx!.globalAlpha = Math.max(0, 1 - (t - tailJ.tMs) / 150);
                ctx!.fillStyle = JUDGMENT_COLORS[tailJ.result];
                ctx!.beginPath();
                ctx!.arc(tp.sx, tp.sy, r * 0.7, 0, Math.PI * 2);
                ctx!.fill();
                ctx!.globalAlpha = 1;
              }
            }
          }
        }

        // Approach circle.
        if (!judged && t < obj.timeMs) {
          const remain = (obj.timeMs - t) / preempt;
          const approachR = r * (1 + 3 * Math.max(0, remain));
          ctx!.globalAlpha = Math.min(1, baseAlpha);
          ctx!.strokeStyle = comboColors?.approach ?? "rgba(255,255,255,0.85)";
          ctx!.lineWidth = 2.5 * scale;
          ctx!.beginPath();
          ctx!.arc(sx, sy, approachR, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.globalAlpha = 1;
        }

        // Hit circle / slider head.
        ctx!.globalAlpha = judged
          ? Math.max(0, 1 - (t - (judgment?.tMs ?? t)) / 150)
          : Math.min(1, baseAlpha);
        ctx!.fillStyle = judged && judgment ? JUDGMENT_COLORS[judgment.result] : fillColor;
        ctx!.beginPath();
        ctx!.arc(sx, sy, r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = "rgba(255,255,255,0.9)";
        ctx!.lineWidth = 2 * scale;
        ctx!.stroke();
        // Combo ring + number.
        ctx!.strokeStyle = "rgba(0,0,0,0.35)";
        ctx!.lineWidth = 4 * scale;
        ctx!.beginPath();
        ctx!.arc(sx, sy, r * 0.72, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
        if (comboColors?.showComboNumbers !== false && !judged) {
          const combo = combos[index] ?? 0;
          if (combo > 0) {
            ctx!.globalAlpha = Math.min(1, baseAlpha);
            ctx!.fillStyle = "#ffffff";
            ctx!.font = `bold ${Math.max(10, r * 0.78)}px sans-serif`;
            ctx!.textAlign = "center";
            ctx!.textBaseline = "middle";
            ctx!.fillText(String(combo), sx, sy + r * 0.04);
            ctx!.globalAlpha = 1;
          }
        }

        // Hit popup (300 / 100 / 50 / X) for judged heads.
        if (comboColors?.showHitPopups !== false && judgment) {
          const age = t - judgment.tMs;
          if (age >= 0 && age < 400) {
            const rise = (age / 400) * 34;
            ctx!.globalAlpha = Math.max(0, 1 - age / 400);
            ctx!.fillStyle = POPUP_COLOR[judgment.result];
            ctx!.font = `bold ${Math.max(12, r * 0.9)}px sans-serif`;
            ctx!.textAlign = "center";
            ctx!.textBaseline = "middle";
            ctx!.fillText(POPUP_LABEL[judgment.result], sx, sy - rise - r * 0.4);
            ctx!.globalAlpha = 1;
          }
        }
      }

      // Cursor + trail from replay frames.
      const cursor = interpolateCursor(frameList, t);
      if (cursor) {
        const trail = trailRef.current;
        trail.push({ x: cursor.x, y: cursor.y, t });
        while (trail.length > 0 && t - trail[0]!.t > 180) trail.shift();
        if (trail.length > 40) trail.splice(0, trail.length - 40);

        ctx!.lineWidth = 2 * scale;
        ctx!.strokeStyle = comboColors?.trail ?? "rgba(255,255,255,0.25)";
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
          : (comboColors?.cursor ?? "rgba(255,255,255,0.9)");
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

function subListFor(
  subs: Map<number, StdPlayfieldJudgment[]>,
  index: number,
  kind: "tick" | "tail",
): StdPlayfieldJudgment | undefined {
  return (subs.get(index) ?? []).find((s) => s.kind === kind);
}

/** Type helper — hit objects on score replay beatmap payload. */
export type StdReplayHitObjects = NonNullable<
  ScoreReplay["beatmap"]
>["hitObjects"];