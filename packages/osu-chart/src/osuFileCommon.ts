export const HIT_CIRCLE = 1;
export const HIT_SLIDER = 2;
export const HIT_SPINNER = 8;

export const HITSOUND_WHISTLE = 2;
export const HITSOUND_FINISH = 4;
export const HITSOUND_CLAP = 8;

export type RawTiming = {
  timeMs: number;
  beatLength: number;
  uninherited: boolean;
};

export type Difficulty = {
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  stackLeniency: number;
  sliderMultiplier: number;
  sliderTickRate: number;
};

export type Point = { x: number; y: number };

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function parseMode(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Mode:")) {
      return line.slice(5).trim();
    }
  }
  return null;
}

export function parseDifficulty(lines: string[]): Difficulty {
  const d: Difficulty = {
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    stackLeniency: 0.7,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
  };
  let inDiff = false;
  let inGeneral = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inDiff = line === "[Difficulty]";
      inGeneral = line === "[General]";
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    const num = Number.parseFloat(value);
    if (inGeneral && key === "StackLeniency" && Number.isFinite(num)) {
      d.stackLeniency = num;
    }
    if (!inDiff || !Number.isFinite(num)) continue;
    if (key === "CircleSize") d.circleSize = num;
    else if (key === "ApproachRate") d.approachRate = num;
    else if (key === "OverallDifficulty") d.overallDifficulty = num;
    else if (key === "SliderMultiplier") d.sliderMultiplier = num;
    else if (key === "SliderTickRate" && num > 0) d.sliderTickRate = num;
  }
  if (!lines.some((l) => l.includes("ApproachRate:"))) {
    d.approachRate = d.overallDifficulty;
  }
  return d;
}

export function parseMeta(lines: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  let inMeta = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inMeta = line === "[Metadata]";
      continue;
    }
    if (!inMeta) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return meta;
}

export function parseBreaks(lines: string[]): Array<[number, number]> {
  const breaks: Array<[number, number]> = [];
  let inEvents = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inEvents = line === "[Events]";
      continue;
    }
    if (!inEvents) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    if (parts[0] !== "2" && parts[0] !== "Break") continue;
    const a = Number.parseInt(parts[1]!, 10);
    const b = Number.parseInt(parts[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) breaks.push([a, b]);
  }
  return breaks;
}

export function parseTimingPoints(lines: string[]): RawTiming[] {
  const points: RawTiming[] = [];
  let inTiming = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inTiming = line === "[TimingPoints]";
      continue;
    }
    if (!inTiming) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const timeMs = Number.parseFloat(parts[0]!);
    const beatLength = Number.parseFloat(parts[1]!);
    if (!Number.isFinite(timeMs) || !Number.isFinite(beatLength)) continue;
    const uninherited =
      parts.length < 7 ? beatLength > 0 : parts[6]!.trim() === "1";
    points.push({
      timeMs,
      beatLength,
      uninherited: uninherited && beatLength > 0,
    });
  }
  points.sort((a, b) => a.timeMs - b.timeMs);
  return points;
}

export type TimingAt = { beatLength: number; sliderVelocity: number };

export function timingAt(points: RawTiming[], timeMs: number): TimingAt {
  let beatLength = 500;
  let sliderVelocity = 1;
  for (const p of points) {
    if (p.timeMs > timeMs) break;
    if (p.uninherited) {
      beatLength = p.beatLength;
      sliderVelocity = 1;
    } else {
      sliderVelocity = clamp(-100 / p.beatLength, 0.1, 10);
    }
  }
  return { beatLength, sliderVelocity };
}

export function computeSliderTicks(
  startMs: number,
  spanDurationMs: number,
  beatLengthMs: number,
  tickRate: number,
  repeats: number,
): { frac: number; tMs: number }[] {
  if (!Number.isFinite(spanDurationMs) || spanDurationMs <= 0) return [];
  const interval =
    (beatLengthMs > 0 ? beatLengthMs : 500) / (tickRate > 0 ? tickRate : 1);
  if (!Number.isFinite(interval) || interval <= 0) return [];
  const count = Math.floor((spanDurationMs - 1) / interval);
  if (count <= 0) return [];

  const ticks: { frac: number; tMs: number }[] = [];
  for (let s = 0; s < repeats; s += 1) {
    const spanStart = startMs + s * spanDurationMs;
    for (let k = 1; k <= count; k += 1) {
      const tickOffset = k * interval;
      ticks.push({
        frac: tickOffset / spanDurationMs,
        tMs: spanStart + tickOffset,
      });
    }
  }
  return ticks;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bezierAt(pts: Point[], t: number): Point {
  let layer = pts.slice();
  while (layer.length > 1) {
    const next: Point[] = [];
    for (let i = 0; i < layer.length - 1; i += 1) {
      next.push(lerp(layer[i]!, layer[i + 1]!, t));
    }
    layer = next;
  }
  return layer[0]!;
}

function sampleBezier(controls: Point[], samplesPerSeg = 24): Point[] {
  if (controls.length === 0) return [];
  if (controls.length === 1) return [controls[0]!];

  const segments: Point[][] = [];
  let cur: Point[] = [controls[0]!];
  for (let i = 1; i < controls.length; i += 1) {
    const p = controls[i]!;
    const prev = controls[i - 1]!;
    if (p.x === prev.x && p.y === prev.y && cur.length > 1) {
      segments.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  segments.push(cur);

  const out: Point[] = [];
  for (const seg of segments) {
    if (seg.length === 1) {
      if (out.length === 0) out.push(seg[0]!);
      continue;
    }
    const n = Math.max(8, samplesPerSeg * (seg.length - 1));
    for (let i = 0; i <= n; i += 1) {
      out.push(bezierAt(seg, i / n));
    }
  }
  return out;
}

function sampleLinear(controls: Point[], samplesPerSeg = 8): Point[] {
  if (controls.length === 0) return [];
  const out: Point[] = [controls[0]!];
  for (let i = 1; i < controls.length; i += 1) {
    const a = controls[i - 1]!;
    const b = controls[i]!;
    for (let s = 1; s <= samplesPerSeg; s += 1) {
      out.push(lerp(a, b, s / samplesPerSeg));
    }
  }
  return out;
}

function samplePerfect(controls: Point[], samples = 48): Point[] {
  if (controls.length < 3) return sampleLinear(controls);
  const [a, b, c] = controls;
  if (!a || !b || !c) return sampleLinear(controls);

  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-3) return sampleLinear(controls);

  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;
  const ux = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
  const uy = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;
  const center = { x: ux, y: uy };
  const r = dist(center, a);

  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const end = Math.atan2(c.y - center.y, c.x - center.x);

  const normalize = (from: number, to: number) => {
    let dlt = to - from;
    while (dlt > Math.PI) dlt -= 2 * Math.PI;
    while (dlt < -Math.PI) dlt += 2 * Math.PI;
    return dlt;
  };

  const total = normalize(start, end);
  const out: Point[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const ang = start + (total * i) / samples;
    out.push({
      x: center.x + r * Math.cos(ang),
      y: center.y + r * Math.sin(ang),
    });
  }
  return out;
}

function sampleCatmull(controls: Point[], samplesPerSeg = 16): Point[] {
  if (controls.length < 2) return controls.slice();
  const out: Point[] = [];
  const pts = [controls[0]!, ...controls, controls[controls.length - 1]!];
  for (let i = 0; i < pts.length - 3; i += 1) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const p2 = pts[i + 2]!;
    const p3 = pts[i + 3]!;
    for (let s = 0; s < samplesPerSeg; s += 1) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(controls[controls.length - 1]!);
  return out;
}

function resampleToLength(path: Point[], pixelLength: number): Point[] {
  if (path.length === 0) return [];
  if (pixelLength <= 0) return [path[0]!];

  const cum: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    cum.push(cum[i - 1]! + dist(path[i - 1]!, path[i]!));
  }
  const total = cum[cum.length - 1]!;
  if (total < 1e-6) return [path[0]!];

  const target = Math.min(pixelLength, total);
  const out: Point[] = [path[0]!];
  const steps = Math.max(8, Math.ceil(target / 4));
  for (let s = 1; s <= steps; s += 1) {
    const want = (target * s) / steps;
    let i = 1;
    while (i < cum.length && cum[i]! < want) i += 1;
    const i1 = Math.min(i, path.length - 1);
    const i0 = Math.max(0, i1 - 1);
    const segLen = cum[i1]! - cum[i0]!;
    const t = segLen > 1e-6 ? (want - cum[i0]!) / segLen : 0;
    out.push(lerp(path[i0]!, path[i1]!, clamp(t, 0, 1)));
  }
  return out;
}

export function sampleCurve(
  curveType: string,
  controls: Point[],
  pixelLength: number,
): Point[] {
  let raw: Point[];
  switch (curveType) {
    case "L":
      raw = sampleLinear(controls);
      break;
    case "P":
      raw = samplePerfect(controls);
      break;
    case "C":
      raw = sampleCatmull(controls);
      break;
    case "B":
    default:
      raw = sampleBezier(controls);
      break;
  }
  return resampleToLength(raw, pixelLength);
}

export function parseSliderPath(
  curveBlob: string,
  start: Point,
): { curveType: string; controls: Point[] } {
  const parts = curveBlob.split("|");
  const curveType = (parts[0] ?? "B").charAt(0).toUpperCase();
  const controls: Point[] = [start];
  for (let i = 1; i < parts.length; i += 1) {
    const xy = parts[i]!.split(":");
    if (xy.length < 2) continue;
    const x = Number.parseFloat(xy[0]!);
    const y = Number.parseFloat(xy[1]!);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    controls.push({ x, y });
  }
  return { curveType, controls };
}

export function pathPointAt(path: Point[], frac: number): Point {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return path[0]!;
  const f = Math.min(1, Math.max(0, frac)) * (path.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(path.length - 1, i0 + 1);
  const t = f - i0;
  const a = path[i0]!;
  const b = path[i1]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function bounceFracAt(u: number, repeats: number): number {
  const prog = Math.min(repeats, Math.max(0, u * repeats));
  const seg = Math.floor(prog);
  let local = prog - seg;
  if (seg % 2 === 1) local = 1 - local;
  return Math.min(1, Math.max(0, local));
}

export function spanDurationMs(
  pixelLength: number,
  sliderMultiplier: number,
  sliderVelocity: number,
  beatLength: number,
): number {
  return (
    (pixelLength / (sliderMultiplier * 100 * sliderVelocity)) * beatLength
  );
}
