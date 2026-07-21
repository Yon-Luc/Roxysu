import type { ChartNote } from "@roxysu/osu-chart";
import type { TierConstraints } from "./tierConstraints";
import type { MarkovTransitionModel, PatternTargets } from "./types";

type MarkovOptions = {
  columnCount: number;
  rng: () => number;
  hitTimes: number[];
  tier: TierConstraints;
  bpm: number;
  starHint: number;
  lnRatio: number;
  model?: MarkovTransitionModel;
  fallbackTargets: Record<string, number>;
};

function bucketLabel(value: number, size: number): string {
  const start = Math.floor(value / size) * size;
  return `${start}-${start + size - 1}`;
}

function starBand(star: number): string {
  const start = Math.floor(star * 2) / 2;
  return `${start}-${start + 0.5}`;
}

function eventSizeFromTargets(targets: Record<string, number>, rng: () => number): number {
  const singleWeight = (targets.delay ?? 0) + 0.15;
  const jumpWeight = (targets.jack ?? 0) + (targets.bracket ?? 0) + 0.05;
  const handWeight = (targets.chordstream ?? 0) + (targets.chordjack ?? 0);
  const quadWeight = Math.max(0, (targets.chordjack ?? 0) - 0.05);
  const roll = rng();
  const total = singleWeight + jumpWeight + handWeight + quadWeight;
  const singleCut = singleWeight / total;
  const jumpCut = singleCut + jumpWeight / total;
  const handCut = jumpCut + handWeight / total;
  if (roll < singleCut) return 1;
  if (roll < jumpCut) return 2;
  if (roll < handCut) return 3;
  return 4;
}

function normalizeEventSize(size: number, tier: TierConstraints): number {
  return Math.max(1, Math.min(size, tier.maxChordSize));
}

function encodeEvent(columns: number[], isLn: boolean): string {
  return `${[...columns].sort((a, b) => a - b).join("+")}:${isLn ? "ln" : "tap"}`;
}

function decodeEvent(
  event: string,
  columnCount: number,
  tier: TierConstraints,
  fallbackTargets: Record<string, number>,
  rng: () => number,
): { columns: number[]; isLn: boolean } {
  const [rawColumns, kind] = event.split(":");
  const parsed = rawColumns
    ?.split("+")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value < columnCount);
  const unique = [...new Set(parsed)];
  if (unique.length > 0) {
    return {
      columns: unique.slice(0, tier.maxChordSize).sort((a, b) => a - b),
      isLn: kind === "ln",
    };
  }

  const size = normalizeEventSize(eventSizeFromTargets(fallbackTargets, rng), tier);
  const picks = new Set<number>();
  while (picks.size < size) picks.add(Math.floor(rng() * columnCount));
  return {
    columns: [...picks].sort((a, b) => a - b),
    isLn: rng() < (fallbackTargets.ln ?? 0),
  };
}

function weightedPick<T>(items: Array<{ value: T; weight: number }>, rng: () => number): T | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1]?.value ?? null;
}

function fallbackColumns(
  previous: number[],
  size: number,
  columnCount: number,
  rng: () => number,
): number[] {
  const picks = new Set<number>();
  for (const column of previous) {
    if (picks.size >= size) break;
    const shifted = (column + (rng() < 0.5 ? -1 : 1) + columnCount) % columnCount;
    picks.add(shifted);
  }
  while (picks.size < size) picks.add(Math.floor(rng() * columnCount));
  return [...picks].sort((a, b) => a - b);
}

function modelLookup(
  model: MarkovTransitionModel | undefined,
  bpmBand: string,
  star: string,
  history: string,
): Array<{ event: string; count: number }> | null {
  if (!model) return null;
  const exact = model.transitions.find(
    (entry) =>
      entry.bpmBand === bpmBand &&
      entry.starBand === star &&
      entry.history === history,
  );
  if (exact) return exact.next;
  const starFallback = model.transitions.find(
    (entry) => entry.starBand === star && entry.history === history,
  );
  if (starFallback) return starFallback.next;
  return model.transitions.find((entry) => entry.history === history)?.next ?? null;
}

export function generateMarkovNotes(options: MarkovOptions): ChartNote[] {
  const order = Math.max(1, options.model?.order ?? 3);
  const bpmBand = bucketLabel(options.bpm, 20);
  const star = starBand(options.starHint);
  const history: string[] = [];
  const notes: ChartNote[] = [];
  let previousColumns: number[] = [Math.floor(options.columnCount / 2)];

  for (const timeMs of options.hitTimes) {
    const historyKey = history.slice(-order).join("|");
    const nextCandidates = history.length >= order
      ? modelLookup(options.model, bpmBand, star, historyKey)
      : null;
    const sampled = weightedPick(
      (nextCandidates ?? []).map((entry) => ({
        value: entry.event,
        weight: entry.count,
      })),
      options.rng,
    );
    const decoded = decodeEvent(
      sampled ?? "",
      options.columnCount,
      options.tier,
      options.fallbackTargets,
      options.rng,
    );
    const size = normalizeEventSize(decoded.columns.length, options.tier);
    const columns =
      decoded.columns.length > 0
        ? decoded.columns.slice(0, size)
        : fallbackColumns(previousColumns, size, options.columnCount, options.rng);
    previousColumns = columns;

    const beatMs = 60_000 / Math.max(options.bpm, 1);
    const lnLength = Math.round(
      Math.max(beatMs * options.tier.minLnBeats, beatMs * (options.lnRatio >= 0.2 ? 0.5 : 0.25)),
    );
    for (const column of columns) {
      notes.push({
        column,
        startMs: Math.round(timeMs),
        endMs: decoded.isLn ? Math.round(timeMs + lnLength) : Math.round(timeMs),
      });
    }
    history.push(encodeEvent(columns, decoded.isLn));
  }

  return notes;
}
