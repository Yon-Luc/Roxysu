import type {
  CorePattern,
  Direction,
  FoundPattern,
  HitObject,
  InterludePatternReport,
  Pattern,
  PatternAnalysisResult,
  PatternCluster,
  PatternType,
  RowInfo,
  SpecificPatterns,
} from "./types.js";
import { Core, forKeyCount } from "./recognisers.js";

/**
 * Interlude/YAVSRG pattern analysis engine.
 * Port of Companella's InterludePatternEngine.cs, itself a port of
 * Prelude.Calculator.Patterns (FindPatterns, Primitives, Clustering, Summary).
 */

const PATTERN_STABILITY_THRESHOLD = 5.0;
const BPM_CLUSTER_THRESHOLD = 5.0;
const MS_PER_MINUTE = 60_000.0;
const DENSITY_SENSITIVITY = 0.9;
const SV_AMOUNT_THRESHOLD = 2000.0;
const MIN_CLUSTER_BPM = 25.0;

export function msPerBeatToBpm(msPerBeat: number): number {
  if (msPerBeat <= 0) return 0;
  return Math.round(MS_PER_MINUTE / msPerBeat);
}

export function calculateBpmFromDelta(deltaMs: number): number {
  if (deltaMs <= 0) return 0;
  return 15000.0 / deltaMs;
}

export function calculateBpmFromTimes(times: number[]): number {
  if (times.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return 0;
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return calculateBpmFromDelta(avg);
}

function detectDirection(previousRow: number[], currentRow: number[]): { direction: Direction; isRoll: boolean } {
  const pLeft = previousRow[0];
  const pRight = previousRow[previousRow.length - 1];
  const cLeft = currentRow[0];
  const cRight = currentRow[currentRow.length - 1];
  const leftChange = cLeft - pLeft;
  const rightChange = cRight - pRight;

  let direction: Direction;
  if (leftChange > 0) {
    direction = rightChange > 0 ? "Right" : "Inwards";
  } else if (leftChange < 0) {
    direction = rightChange < 0 ? "Left" : "Outwards";
  } else {
    direction = rightChange < 0 ? "Inwards" : rightChange > 0 ? "Outwards" : "None";
  }

  const isRoll = pLeft > cRight || pRight < cLeft;
  return { direction, isRoll };
}

function countOverlap(previousRow: number[], currentRow: number[]): number {
  const previous = new Set(previousRow);
  let overlap = 0;
  for (const column of currentRow) {
    if (previous.has(column)) overlap++;
  }
  return overlap;
}

function buildRows(hitObjects: HitObject[], keyCount: number): RowInfo[] {
  const byTime = new Map<number, Set<number>>();
  for (const h of hitObjects) {
    if (h.type !== "Circle" && h.type !== "Hold") continue;
    let set = byTime.get(h.time);
    if (!set) {
      set = new Set();
      byTime.set(h.time, set);
    }
    set.add(h.column);
  }

  const noteRows = Array.from(byTime.entries())
    .map(([time, cols]) => ({ time, columns: Array.from(cols).sort((a, b) => a - b) }))
    .filter((r) => r.columns.length > 0)
    .sort((a, b) => a.time - b.time);

  if (noteRows.length === 0) return [];

  const result: RowInfo[] = [];
  let previousRow = noteRows[0].columns;
  let previousTime = noteRows[0].time;
  const firstTime = noteRows[0].time;

  for (let i = 1; i < noteRows.length; i++) {
    const current = noteRows[i];
    const currentRow = current.columns;
    const { direction, isRoll } = detectDirection(previousRow, currentRow);
    const overlap = countOverlap(previousRow, currentRow);

    result.push({
      index: i,
      time: current.time - firstTime,
      msPerBeat: (current.time - previousTime) * 4.0,
      notes: currentRow.length,
      jacks: overlap,
      direction,
      roll: isRoll,
      density: 0,
      rawNotes: currentRow,
    });

    previousRow = currentRow;
    previousTime = current.time;
  }

  return result;
}

function calculateDensity(rows: RowInfo[], keyCount: number): number[] {
  const columnDensities = new Array(keyCount).fill(0);
  const columnSince = new Array(keyCount).fill(-Infinity);
  const densities = new Array(rows.length).fill(0);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const time = row.time;

    for (const column of row.rawNotes) {
      const delta = time - columnSince[column];
      const nextDensity = delta > 0 && Number.isFinite(delta) ? 1000.0 / delta : 0.0;
      columnDensities[column] = columnDensities[column] * DENSITY_SENSITIVITY + nextDensity * (1.0 - DENSITY_SENSITIVITY);
      columnSince[column] = time;
    }

    densities[i] = Math.max(...columnDensities);
  }

  return densities;
}

function resolveSpecificMatch(
  coreLength: number,
  recognisers: Array<[string, (rows: RowInfo[]) => number]>,
  remaining: RowInfo[],
): { length: number; specificType: string | null } {
  for (const [name, recogniser] of recognisers) {
    const specificLength = recogniser(remaining);
    if (specificLength > 0) {
      return { length: Math.max(coreLength, specificLength), specificType: name };
    }
  }
  return { length: coreLength, specificType: null };
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function tryAddPattern(
  results: FoundPattern[],
  remaining: RowInfo[],
  specificRecognisers: Array<[string, (rows: RowInfo[]) => number]>,
  corePattern: CorePattern,
  lastNoteTime: number,
): void {
  const coreLength =
    corePattern === "Stream" ? Core.stream(remaining) : corePattern === "Chordstream" ? Core.chordstream(remaining) : 0;

  if (coreLength === 0) return;

  const { length, specificType } = resolveSpecificMatch(coreLength, specificRecognisers, remaining);
  const matched = remaining.slice(0, length);
  const meanMsPerBeat = average(matched.map((r) => r.msPerBeat));
  const mixed = matched.some((r) => Math.abs(r.msPerBeat - meanMsPerBeat) >= PATTERN_STABILITY_THRESHOLD);
  const end = remaining.length > length ? remaining[length].time : lastNoteTime;

  results.push({
    pattern: corePattern,
    specificType,
    mixed,
    start: remaining[0].time,
    end,
    msPerBeat: meanMsPerBeat,
    density: average(matched.map((r) => r.density)),
  });
}

function tryAddJackPattern(
  results: FoundPattern[],
  remaining: RowInfo[],
  jackRecognisers: Array<[string, (rows: RowInfo[]) => number]>,
  lastNoteTime: number,
): void {
  const coreLength = Core.jacks(remaining);
  if (coreLength === 0) return;

  const { length, specificType } = resolveSpecificMatch(coreLength, jackRecognisers, remaining);
  const matched = remaining.slice(0, length);
  const meanMsPerBeat = average(matched.map((r) => r.msPerBeat));
  const mixed = matched.some((r) => Math.abs(r.msPerBeat - meanMsPerBeat) >= PATTERN_STABILITY_THRESHOLD);
  const nextTime = remaining.length > length ? remaining[length].time : lastNoteTime;
  const end = Math.max(remaining[0].time + remaining[0].msPerBeat * 0.5, nextTime);

  results.push({
    pattern: "Jacks",
    specificType,
    mixed,
    start: remaining[0].time,
    end,
    msPerBeat: meanMsPerBeat,
    density: average(matched.map((r) => r.density)),
  });
}

function findPatterns(rows: RowInfo[], specificPatterns: SpecificPatterns, lastNoteTime: number): FoundPattern[] {
  const results: FoundPattern[] = [];

  for (let remainingStart = 0; remainingStart < rows.length; remainingStart++) {
    const remaining = rows.slice(remainingStart);
    tryAddPattern(results, remaining, specificPatterns.stream, "Stream", lastNoteTime);
    tryAddPattern(results, remaining, specificPatterns.chordstream, "Chordstream", lastNoteTime);
    tryAddJackPattern(results, remaining, specificPatterns.jack, lastNoteTime);
  }

  return results;
}

class ClusterBuilder {
  sumMsPerBeat = 0;
  originalMsPerBeat: number;
  count = 0;
  private bpm: number | null = null;

  constructor(originalMsPerBeat: number) {
    this.originalMsPerBeat = originalMsPerBeat;
  }

  add(msPerBeat: number): void {
    this.sumMsPerBeat += msPerBeat;
  }

  calculate(): void {
    if (this.count <= 0) return;
    this.bpm = Math.round(MS_PER_MINUTE / (this.sumMsPerBeat / this.count));
  }

  get value(): number {
    return this.bpm ?? 0;
  }
}

function ratingMultiplier(pattern: CorePattern): number {
  switch (pattern) {
    case "Stream":
      return 1.0 / 3.0;
    case "Chordstream":
      return 0.5;
    case "Jacks":
      return 1.0;
  }
}

function resolveDisplayName(pattern: CorePattern, specificTypes: Array<[string, number]>): string {
  if (specificTypes.length > 0 && specificTypes[0][1] > 0.4) return specificTypes[0][0];

  if (
    specificTypes.length >= 2 &&
    specificTypes[0][0] === "Jumpstream" &&
    specificTypes[1][0] === "Handstream" &&
    specificTypes[1][1] / specificTypes[0][1] > 0.4
  ) {
    return "Jump/Handstream";
  }

  return pattern;
}

function patternAmount(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let currentStart = sorted[0][0];
  let currentEnd = sorted[0][1];

  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i];
    if (currentEnd < end) {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    } else {
      currentEnd = Math.max(currentEnd, end);
    }
  }

  total += currentEnd - currentStart;
  return total;
}

function clusterPatterns(patterns: FoundPattern[]): PatternCluster[] {
  const nonMixedClusters: ClusterBuilder[] = [];
  const mixedClusters = new Map<CorePattern, ClusterBuilder>();

  const patternsWithClusters = patterns.map((pattern) => {
    let builder: ClusterBuilder;

    if (pattern.mixed) {
      let mixedBuilder = mixedClusters.get(pattern.pattern);
      if (!mixedBuilder) {
        mixedBuilder = new ClusterBuilder(pattern.msPerBeat);
        mixedClusters.set(pattern.pattern, mixedBuilder);
      }
      builder = mixedBuilder;
    } else {
      const existing = nonMixedClusters.find(
        (c) => Math.abs(c.originalMsPerBeat - pattern.msPerBeat) < BPM_CLUSTER_THRESHOLD,
      );
      if (existing) {
        builder = existing;
      } else {
        builder = new ClusterBuilder(pattern.msPerBeat);
        nonMixedClusters.push(builder);
      }
    }

    builder.count++;
    builder.add(pattern.msPerBeat);
    return { pattern, builder };
  });

  for (const cluster of nonMixedClusters) cluster.calculate();
  for (const cluster of mixedClusters.values()) cluster.calculate();

  // Group by (pattern, mixed, bpm)
  const groups = new Map<string, { pattern: CorePattern; mixed: boolean; bpm: number; items: FoundPattern[] }>();
  for (const { pattern, builder } of patternsWithClusters) {
    const key = `${pattern.pattern}|${pattern.mixed}|${builder.value}`;
    let group = groups.get(key);
    if (!group) {
      group = { pattern: pattern.pattern, mixed: pattern.mixed, bpm: builder.value, items: [] };
      groups.set(key, group);
    }
    group.items.push(pattern);
  }

  const clusters: PatternCluster[] = [];
  for (const { pattern: patternType, mixed, bpm, items: data } of groups.values()) {
    const amount = patternAmount(data.map((p): [number, number] => [p.start, p.end]));

    const specificCounts = new Map<string, number>();
    for (const p of data) {
      if (p.specificType != null) {
        specificCounts.set(p.specificType, (specificCounts.get(p.specificType) ?? 0) + 1);
      }
    }
    const specificTypes: Array<[string, number]> = Array.from(specificCounts.entries())
      .map(([name, count]): [string, number] => [name, count / data.length])
      .sort((a, b) => b[1] - a[1]);

    const displayName = resolveDisplayName(patternType, specificTypes);

    clusters.push({
      pattern: patternType,
      displayName,
      specificTypes,
      bpm,
      mixed,
      amountMs: amount,
      importance: amount * ratingMultiplier(patternType) * bpm,
    });
  }

  return clusters
    .filter((c) => c.bpm > MIN_CLUSTER_BPM)
    .sort((a, b) => b.amountMs - a.amountMs);
}

function pruneClusters(clusters: PatternCluster[]): PatternCluster[] {
  const canBePruned = (cluster: PatternCluster) =>
    clusters.some(
      (other) => other.pattern === cluster.pattern && other.amountMs * 0.5 > cluster.amountMs && other.bpm > cluster.bpm,
    );

  const kept = clusters.filter((c) => !canBePruned(c));

  const pruned = [
    ...kept.filter((c) => c.pattern === "Stream").slice(0, 3),
    ...kept.filter((c) => c.pattern === "Chordstream").slice(0, 3),
    ...kept.filter((c) => c.pattern === "Jacks").slice(0, 3),
  ].sort((a, b) => b.importance - a.importance);

  return pruned;
}

function categoriseChart(clusters: PatternCluster[], svAmountMs: number): string {
  if (clusters.length === 0) return svAmountMs >= SV_AMOUNT_THRESHOLD ? "SV" : "Uncategorised";

  const topImportance = clusters[0].importance;
  const important = [];
  for (const c of clusters) {
    if (c.importance / topImportance > 0.5) important.push(c);
    else break;
  }
  const cluster1 = important[0];
  const cluster2 = important.length > 1 ? important[1] : null;

  const isStreamLike = (p: CorePattern) => p === "Stream" || p === "Chordstream";
  const isHybrid =
    cluster2 != null &&
    ((cluster2.pattern === "Jacks" && isStreamLike(cluster1.pattern)) ||
      (isStreamLike(cluster2.pattern) && cluster1.pattern === "Jacks"));

  const isTech = cluster1.mixed;
  const isSv = svAmountMs >= SV_AMOUNT_THRESHOLD;

  const name = resolveDisplayName(cluster1.pattern, cluster1.specificTypes);

  return `${name}${isHybrid ? " Hybrid" : ""}${isTech ? " Tech" : ""}${isSv ? " + SV" : ""}`;
}

export function mapSpecificTypeToPatternType(specificType: string | null, corePattern: CorePattern): PatternType {
  if (specificType != null) {
    switch (specificType) {
      case "Trills":
      case "Minitrills":
        return "Trill";
      case "Rolls":
        return "Roll";
      case "Handstream":
        return "Handstream";
      case "Jumpstream":
      case "Jumpstream/Handstream":
        return "Jumpstream";
      case "Split Trill":
        return "Jumptrill";
      case "Jumptrill":
        return "Jumptrill";
      case "Longjacks":
        return "Jack";
      case "Quadstream":
        return "Quad";
      case "Gluts":
        return "Jack";
      case "Chordjacks":
        return "Chordjack";
      case "Minijacks":
        return "Minijack";
      case "Brackets":
        return "Bracket";
      case "Double Stream":
      case "Dense Chordstream":
      case "Light Chordstream":
        return "Jumpstream";
      default:
        return mapCorePattern(corePattern);
    }
  }
  return mapCorePattern(corePattern);
}

function mapCorePattern(corePattern: CorePattern): PatternType {
  switch (corePattern) {
    case "Stream":
      return "Stream";
    case "Chordstream":
      return "Jumpstream";
    case "Jacks":
      return "Jack";
  }
}

/** Runs the full Interlude-style pattern analysis over a set of chart rows. */
export function analyze(hitObjects: HitObject[], keyCount: number): InterludePatternReport {
  const rows = buildRows(hitObjects, keyCount);
  if (rows.length === 0) {
    return {
      foundPatterns: [],
      clusters: [],
      category: "Unknown",
      durationMs: 0,
      firstNoteTimeMs: 0,
      totalRows: 0,
    };
  }

  const density = calculateDensity(rows, keyCount);
  for (let i = 0; i < rows.length; i++) rows[i] = { ...rows[i], density: density[i] };

  const times = hitObjects.map((h) => h.time);
  const firstNoteTime = Math.min(...times);
  const chartDuration = Math.max(0, Math.max(...times) - firstNoteTime);
  const relativeLastNoteTime = rows.length > 0 ? rows[rows.length - 1].time : chartDuration;

  const specificPatterns = forKeyCount(keyCount);
  const foundPatterns = findPatterns(rows, specificPatterns, relativeLastNoteTime);
  const clusters = clusterPatterns(foundPatterns);
  const prunedClusters = pruneClusters(clusters);
  const category = categoriseChart(prunedClusters, 0.0);

  return {
    foundPatterns,
    clusters: prunedClusters,
    category,
    durationMs: chartDuration,
    firstNoteTimeMs: firstNoteTime,
    totalRows: rows.length,
  };
}

function estimateNoteCount(found: FoundPattern, hitObjects: HitObject[], firstNoteTimeMs: number): number {
  const start = firstNoteTimeMs + found.start;
  const end = firstNoteTimeMs + found.end;
  return hitObjects.filter((h) => h.time >= start && h.time <= end).length;
}

/** Finds all patterns in a chart's hit objects, matching PatternFinder.FindAllPatterns. */
export function findAllPatterns(hitObjects: HitObject[], keyCount = 4): PatternAnalysisResult {
  const result: PatternAnalysisResult = {
    success: false,
    totalNotes: hitObjects.length,
    analysisDurationMs: 0,
    patterns: {},
    interludeClusters: [],
    interludeCategory: "Unknown",
    chartDurationMs: 0,
    chartFirstNoteTimeMs: 0,
  };

  if (hitObjects.length === 0) return result;

  const startTime = Date.now();

  try {
    const report = analyze(hitObjects, keyCount);

    result.interludeClusters = report.clusters;
    result.interludeCategory = report.category;
    result.chartDurationMs = report.durationMs;
    result.chartFirstNoteTimeMs = report.firstNoteTimeMs;

    for (const found of report.foundPatterns) {
      const patternType = mapSpecificTypeToPatternType(found.specificType, found.pattern);
      const pattern: Pattern = {
        type: patternType,
        startTime: found.start,
        endTime: found.end,
        bpm: found.msPerBeat > 0 ? msPerBeatToBpm(found.msPerBeat) : 0,
        noteCount: estimateNoteCount(found, hitObjects, report.firstNoteTimeMs),
        specificName: found.specificType,
        mixed: found.mixed,
        corePattern: found.pattern,
      };

      if (!result.patterns[patternType]) result.patterns[patternType] = [];
      result.patterns[patternType]!.push(pattern);
    }

    result.success = true;
  } catch (ex) {
    result.success = false;
    result.errorMessage = ex instanceof Error ? ex.message : String(ex);
  }

  result.analysisDurationMs = Date.now() - startTime;
  return result;
}
