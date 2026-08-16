import type { BeatmapPreview } from "./api";
import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import { defaultTaikoSkin, type TaikoSkin } from "./taikoSkin";

export type PaintContext2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type TaikoHitObject = NonNullable<
  BeatmapPreview["taikoHitObjects"]
>[number];

export type TaikoPlayfieldFrame = {
  tMs: number;
  keys: number;
};

export type TaikoPlayfieldJudgment = {
  noteIndex: number;
  tMs: number;
  result: ReplayJudgmentResult;
  errorMs?: number | null;
  kind?: "hit" | "roll" | "swell";
};

const POPUP_LABEL: Record<ReplayJudgmentResult, string> = {
  perfect: "300",
  great: "300",
  good: "150",
  ok: "150",
  meh: "0",
  miss: "X",
};

const POPUP_COLOR: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffffff",
  great: "#ffffff",
  good: "#fdba74",
  ok: "#fdba74",
  meh: "#f9a8d4",
  miss: "#ff6666",
};

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function objectEndMs(obj: TaikoHitObject): number {
  if (obj.type === "hit") return obj.timeMs;
  return obj.endMs;
}

function noteColor(obj: Extract<TaikoHitObject, { type: "hit" }>, skin: TaikoSkin): string {
  if (obj.color === "don") return obj.large ? skin.donLarge : skin.don;
  return obj.large ? skin.katLarge : skin.kat;
}

export function buildTaikoJudgmentMap(
  judgments: TaikoPlayfieldJudgment[] | undefined,
): Map<number, TaikoPlayfieldJudgment[]> {
  const map = new Map<number, TaikoPlayfieldJudgment[]>();
  if (!judgments) return map;
  for (const j of judgments) {
    const list = map.get(j.noteIndex) ?? [];
    list.push(j);
    map.set(j.noteIndex, list);
  }
  return map;
}

function interpolateKeys(
  frames: TaikoPlayfieldFrame[],
  t: number,
): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return 0;
  return frames[idx]!.keys;
}

export type PaintTaikoPlayfieldArgs = {
  ctx: PaintContext2D;
  width: number;
  height: number;
  tMs: number;
  hitObjects: TaikoHitObject[];
  frames?: TaikoPlayfieldFrame[];
  judgments?: TaikoPlayfieldJudgment[];
  hidden?: boolean;
  skin?: TaikoSkin | null;
  judgmentMap?: Map<number, TaikoPlayfieldJudgment[]>;
};

export function paintTaikoPlayfield(args: PaintTaikoPlayfieldArgs): void {
  const {
    ctx,
    width: w,
    height: h,
    tMs: t,
    hitObjects: objs,
    frames = [],
    hidden = false,
    skin: skinArg,
  } = args;
  const skin = skinArg ?? defaultTaikoSkin();
  const judgmentMap = args.judgmentMap ?? buildTaikoJudgmentMap(args.judgments);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = skin.playfield;
  ctx.fillRect(0, 0, w, h);

  const laneH = Math.min(h * 0.55, 160);
  const laneY = (h - laneH) / 2;
  const receptorX = Math.max(56, w * 0.16);
  const noteR = Math.max(10, (laneH * 0.28) * skin.noteScale);
  const scroll = skin.scrollSpeed;
  const lookAhead = ((w - receptorX) / scroll) * 1000 + 80;
  const lookBehind = 220;

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, laneY, w, laneH);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, laneY + 0.5);
  ctx.lineTo(w, laneY + 0.5);
  ctx.moveTo(0, laneY + laneH - 0.5);
  ctx.lineTo(w, laneY + laneH - 0.5);
  ctx.stroke();

  if (skin.showBarlines) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    const beat = 500;
    const first = Math.floor((t - lookBehind) / beat) * beat;
    for (let bt = first; bt < t + lookAhead; bt += beat) {
      const x = receptorX + ((bt - t) / 1000) * scroll;
      if (x < 0 || x > w) continue;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, laneY);
      ctx.lineTo(x + 0.5, laneY + laneH);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = hexToRgba(skin.hitLine, 0.85);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(receptorX, laneY);
  ctx.lineTo(receptorX, laneY + laneH);
  ctx.stroke();

  const keys = interpolateKeys(frames, t);
  const pressed = keys !== 0;
  ctx.beginPath();
  ctx.arc(receptorX, laneY + laneH / 2, noteR * 1.05, 0, Math.PI * 2);
  ctx.strokeStyle = hexToRgba(skin.receptor, pressed ? 1 : 0.7);
  ctx.lineWidth = pressed ? 4 : 2.5;
  ctx.stroke();
  if (pressed) {
    ctx.fillStyle = hexToRgba(skin.receptor, 0.12);
    ctx.fill();
  }

  const midY = laneY + laneH / 2;

  for (let i = 0; i < objs.length; i += 1) {
    const obj = objs[i]!;
    const start = obj.timeMs;
    const end = objectEndMs(obj);
    if (end < t - lookBehind || start > t + lookAhead) continue;

    const judged = judgmentMap.get(i);
    const headJ = judged?.find((j) => j.kind !== "roll") ?? judged?.[0];
    const hitDone = headJ != null && headJ.tMs <= t && headJ.result !== "miss";

    if (obj.type === "drumroll") {
      const x0 = receptorX + ((obj.timeMs - t) / 1000) * scroll;
      const x1 = receptorX + ((obj.endMs - t) / 1000) * scroll;
      const left = Math.max(0, Math.min(x0, x1));
      const right = Math.min(w, Math.max(x0, x1));
      if (right > left) {
        ctx.fillStyle = hexToRgba(skin.drumroll, 0.85);
        const hgt = noteR * (obj.large ? 1.7 : 1.15);
        ctx.beginPath();
        ctx.roundRect(left, midY - hgt / 2, right - left, hgt, hgt / 2);
        ctx.fill();
      }
      continue;
    }

    if (obj.type === "swell") {
      if (t < obj.timeMs - 80 || t > obj.endMs + 80) continue;
      const u = Math.min(
        1,
        Math.max(0, (t - obj.timeMs) / Math.max(1, obj.endMs - obj.timeMs)),
      );
      const r = noteR * (1.2 + u * 1.6);
      ctx.beginPath();
      ctx.arc(receptorX, midY, r, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(skin.swell, 0.85);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = hexToRgba(skin.swell, 0.12);
      ctx.fill();
      continue;
    }

    if (hitDone && obj.type === "hit") continue;

    const x = receptorX + ((obj.timeMs - t) / 1000) * scroll;
    if (x < -noteR * 3 || x > w + noteR * 3) continue;

    let alpha = 1;
    if (hidden) {
      const untilHit = obj.timeMs - t;
      const fadeStart = lookAhead * 0.4;
      if (untilHit < fadeStart) {
        alpha = Math.max(0, untilHit / fadeStart);
      }
    }
    if (alpha <= 0) continue;

    const r = noteR * (obj.large ? 1.35 : 1);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, midY, r, 0, Math.PI * 2);
    ctx.fillStyle = noteColor(obj, skin);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (obj.large) {
      ctx.beginPath();
      ctx.arc(x, midY, r * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (skin.showHitPopups && judgedPopups(judgmentMap, t, receptorX, midY, ctx)) {
    // drawn inside helper
  }
}

function judgedPopups(
  map: Map<number, TaikoPlayfieldJudgment[]>,
  t: number,
  x: number,
  y: number,
  ctx: PaintContext2D,
): boolean {
  let drew = false;
  for (const list of map.values()) {
    for (const j of list) {
      if (j.kind === "roll") continue;
      const age = t - j.tMs;
      if (age < 0 || age > 280) continue;
      const u = age / 280;
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = POPUP_COLOR[j.result];
      ctx.font = "700 16px Figtree, ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POPUP_LABEL[j.result], x, y - 28 - u * 18);
      ctx.globalAlpha = 1;
      drew = true;
    }
  }
  return drew;
}
