import type { ParsedStdChart, StdHitObject, StdPoint } from "./stdTypes";

const HIT_CIRCLE = 1;
const HIT_SLIDER = 2;
const HIT_SPINNER = 8;

type RawTiming = {
  timeMs: number;
  beatLength: number;
  /** Uninherited when true. */
  uninherited: boolean;
};

type Difficulty = {
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  stackLeniency: number;
  sliderMultiplier: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function dist(a: StdPoint, b: StdPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Approach preempt in ms from AR (osu!stable). */
export function approachPreemptMs(ar: number): number {
  if (ar < 5) return 1800 - 120 * ar;
  return 1200 - 150 * (ar - 5);
}

/** Circle radius in osu! pixels from CS. */
export function circleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

function parseDifficulty(lines: string[]): Difficulty {
  const d: Difficulty = {
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    stackLeniency: 0.7,
    sliderMultiplier: 1.4,
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
  }
  // Older maps omit AR — fall back to OD.
  if (!lines.some((l) => l.includes("ApproachRate:"))) {
    d.approachRate = d.overallDifficulty;
  }
  return d;
}

function parseMode(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Mode:")) {
      return line.slice(5).trim();
    }
  }
  return null;
}

function parseMeta(lines: string[]): Record<string, string> {
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

function parseBreaks(lines: string[]): Array<[number, number]> {
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

function parseTimingPoints(lines: string[]): RawTiming[] {
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
    points.push({ timeMs, beatLength, uninherited: uninherited && beatLength > 0 });
  }
  points.sort((a, b) => a.timeMs - b.timeMs);
  return points;
}

type TimingAt = { beatLength: number; sliderVelocity: number };

function timingAt(points: RawTiming[], timeMs: number): TimingAt {
  let beatLength = 500;
  let sliderVelocity = 1;
  for (const p of points) {
    if (p.timeMs > timeMs) break;
    if (p.uninherited) {
      beatLength = p.beatLength;
      sliderVelocity = 1;
    } else {
      // Inherited: beatLength is negative percent of SV.
      sliderVelocity = clamp(-100 / p.beatLength, 0.1, 10);
    }
  }
  return { beatLength, sliderVelocity };
}

function lerp(a: StdPoint, b: StdPoint, t: number): StdPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Sample a cubic bezier through control points (osu! multi-segment). */
function sampleBezier(controls: StdPoint[], samplesPerSeg = 24): StdPoint[] {
  if (controls.length === 0) return [];
  if (controls.length === 1) return [controls[0]!];

  // Split on repeated anchor points (osu! bezier segments).
  const segments: StdPoint[][] = [];
  let cur: StdPoint[] = [controls[0]!];
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

  const out: StdPoint[] = [];
  for (const seg of segments) {
    if (seg.length === 1) {
      if (out.length === 0) out.push(seg[0]!);
      continue;
    }
    const n = Math.max(8, samplesPerSeg * (seg.length - 1));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      out.push(bezierAt(seg, t));
    }
  }
  return out;
}

function bezierAt(pts: StdPoint[], t: number): StdPoint {
  let layer = pts.slice();
  while (layer.length > 1) {
    const next: StdPoint[] = [];
    for (let i = 0; i < layer.length - 1; i += 1) {
      next.push(lerp(layer[i]!, layer[i + 1]!, t));
    }
    layer = next;
  }
  return layer[0]!;
}

function sampleLinear(controls: StdPoint[], samplesPerSeg = 8): StdPoint[] {
  if (controls.length === 0) return [];
  const out: StdPoint[] = [controls[0]!];
  for (let i = 1; i < controls.length; i += 1) {
    const a = controls[i - 1]!;
    const b = controls[i]!;
    for (let s = 1; s <= samplesPerSeg; s += 1) {
      out.push(lerp(a, b, s / samplesPerSeg));
    }
  }
  return out;
}

/** Perfect circle through 3 points (osu! P curve). */
function samplePerfect(controls: StdPoint[], samples = 48): StdPoint[] {
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
  const mid = Math.atan2(b.y - center.y, b.x - center.x);
  const end = Math.atan2(c.y - center.y, c.x - center.x);

  const normalize = (from: number, to: number) => {
    let dlt = to - from;
    while (dlt > Math.PI) dlt -= 2 * Math.PI;
    while (dlt < -Math.PI) dlt += 2 * Math.PI;
    return dlt;
  };

  const toMid = normalize(start, mid);
  const toEnd = normalize(start, end);
  // Prefer direction that passes near mid.
  if (toMid * toEnd < 0) {
    // end is wrong way relative to mid — go the long way
  }
  const total = toEnd;

  const out: StdPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const ang = start + (total * i) / samples;
    out.push({
      x: center.x + r * Math.cos(ang),
      y: center.y + r * Math.sin(ang),
    });
  }
  return out;
}

/** Catmull-Rom through control points (legacy C curves). */
function sampleCatmull(controls: StdPoint[], samplesPerSeg = 16): StdPoint[] {
  if (controls.length < 2) return controls.slice();
  const out: StdPoint[] = [];
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

function resampleToLength(path: StdPoint[], pixelLength: number): StdPoint[] {
  if (path.length === 0) return [];
  if (pixelLength <= 0) return [path[0]!];

  const cum: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    cum.push(cum[i - 1]! + dist(path[i - 1]!, path[i]!));
  }
  const total = cum[cum.length - 1]!;
  if (total < 1e-6) return [path[0]!];

  const target = Math.min(pixelLength, total);
  const out: StdPoint[] = [path[0]!];
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

function sampleCurve(
  curveType: string,
  controls: StdPoint[],
  pixelLength: number,
): StdPoint[] {
  let raw: StdPoint[];
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

function parseSliderPath(
  curveBlob: string,
  start: StdPoint,
): { curveType: string; controls: StdPoint[] } {
  const parts = curveBlob.split("|");
  const curveType = (parts[0] ?? "B").charAt(0).toUpperCase();
  const controls: StdPoint[] = [start];
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

function applyStacking(
  objects: StdHitObject[],
  stackLeniency: number,
  approachRate: number,
): void {
  const preempt = approachPreemptMs(approachRate);
  const stackThreshold = preempt * stackLeniency;
  const stackOffset = circleRadius(0) / 10; // ~5.4 — visual nudge per stack level
  const n = objects.length;
  const stackCounts = new Array<number>(n).fill(0);

  for (let i = n - 1; i > 0; i -= 1) {
    const objI = objects[i]!;
    if (objI.type === "spinner") continue;

    let nFound = i;
    for (let j = i - 1; j >= 0; j -= 1) {
      const objJ = objects[j]!;
      if (objJ.type === "spinner") continue;

      const endTimeJ =
        objJ.type === "slider" ? objJ.endMs : objJ.timeMs;
      if (objI.timeMs - endTimeJ > stackThreshold) break;

      const xi = objI.x;
      const yi = objI.y;
      const xj = objJ.x;
      const yj = objJ.y;

      // Stack if start positions coincide (within 3px).
      if (Math.hypot(xi - xj, yi - yj) < 3) {
        stackCounts[j] = stackCounts[nFound]! + 1;
        nFound = j;
      } else if (
        objJ.type === "slider" &&
        objJ.path.length > 0
      ) {
        // Slider tail stacking (simplified): stack onto end of path.
        const end = objJ.path[objJ.path.length - 1]!;
        if (Math.hypot(xi - end.x, yi - end.y) < 3) {
          stackCounts[j] = stackCounts[nFound]! + 1;
          nFound = j;
        }
      }
    }
  }

  for (let i = 0; i < n; i += 1) {
    const obj = objects[i]!;
    const sc = stackCounts[i] ?? 0;
    if (sc === 0 || obj.type === "spinner") continue;
    const dx = -stackOffset * sc;
    const dy = -stackOffset * sc;
    obj.stackX = obj.x + dx;
    obj.stackY = obj.y + dy;
    if (obj.type === "slider") {
      obj.path = obj.path.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  }
}

function parseHitObjects(
  lines: string[],
  timing: RawTiming[],
  sliderMultiplier: number,
): StdHitObject[] {
  const objects: StdHitObject[] = [];
  let inHit = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inHit = line === "[HitObjects]";
      continue;
    }
    if (!inHit) continue;

    const parts = line.split(",");
    if (parts.length < 5) continue;
    const x = Number.parseFloat(parts[0]!);
    const y = Number.parseFloat(parts[1]!);
    const timeMs = Number.parseFloat(parts[2]!);
    const type = Number.parseInt(parts[3]!, 10);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(timeMs) ||
      !Number.isFinite(type)
    ) {
      continue;
    }

    if (type & HIT_SPINNER) {
      const endMs = Number.parseFloat(parts[5] ?? "");
      if (!Number.isFinite(endMs) || endMs <= timeMs) continue;
      objects.push({ type: "spinner", timeMs, endMs });
      continue;
    }

    if (type & HIT_SLIDER) {
      if (parts.length < 8) continue;
      const { curveType, controls } = parseSliderPath(parts[5]!, { x, y });
      const repeats = Math.max(1, Number.parseInt(parts[6]!, 10) || 1);
      const pixelLength = Number.parseFloat(parts[7]!);
      if (!Number.isFinite(pixelLength) || pixelLength <= 0) continue;

      const path = sampleCurve(curveType, controls, pixelLength);
      const { beatLength, sliderVelocity } = timingAt(timing, timeMs);
      const spanDuration =
        (pixelLength / (sliderMultiplier * 100 * sliderVelocity)) * beatLength;
      const endMs = timeMs + spanDuration * repeats;

      objects.push({
        type: "slider",
        x,
        y,
        timeMs,
        endMs,
        path,
        repeats,
        pixelLength,
        stackX: x,
        stackY: y,
      });
      continue;
    }

    if (type & HIT_CIRCLE) {
      objects.push({
        type: "circle",
        x,
        y,
        timeMs,
        stackX: x,
        stackY: y,
      });
    }
  }

  objects.sort((a, b) => a.timeMs - b.timeMs);
  return objects;
}

/** Parse `.osu` text into a Standard (mode 0) chart. */
export function parseStdChart(osuText: string): ParsedStdChart {
  const lines = osuText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const mode = parseMode(lines);
  const empty = (): ParsedStdChart => ({
    gameMode: "0",
    status: "Fail",
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    stackLeniency: 0.7,
    sliderMultiplier: 1.4,
    hitObjects: [],
    timingPoints: [],
    breaks: [],
    metaData: {},
  });

  if (mode != null && mode !== "0") {
    return { ...empty(), status: "NotStd" };
  }

  const diff = parseDifficulty(lines);
  const timing = parseTimingPoints(lines);
  const hitObjects = parseHitObjects(lines, timing, diff.sliderMultiplier);
  applyStacking(hitObjects, diff.stackLeniency, diff.approachRate);

  const uninherited: Array<[number, number]> = timing
    .filter((t) => t.uninherited)
    .map((t) => [t.timeMs, t.beatLength]);

  return {
    gameMode: "0",
    status: hitObjects.length > 0 ? "OK" : "Fail",
    circleSize: diff.circleSize,
    approachRate: diff.approachRate,
    overallDifficulty: diff.overallDifficulty,
    stackLeniency: diff.stackLeniency,
    sliderMultiplier: diff.sliderMultiplier,
    hitObjects,
    timingPoints: uninherited.length ? uninherited : [[0, 500]],
    breaks: parseBreaks(lines),
    metaData: parseMeta(lines),
  };
}

export type { ParsedStdChart, StdHitObject, StdPoint };
