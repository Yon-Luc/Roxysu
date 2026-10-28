/**
 * Hit-object graph + ManiaMapData + pattern preprocessor.
 * Mirrors CreateDifficultyHitObjects + ManiaPatternContextPreprocessor.
 */

import { ColumnPatternUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ColumnPatternUtils";
import { DiffUtils } from "../../generated/osu.Game/Rulesets/Difficulty/Utils/DiffUtils";
import { ChordUtils } from "../../generated/osu.Game.Rulesets.Mania/Difficulty/Utils/ChordUtils";
import {
  emptyShapeCounts,
  type ShapeLabel,
  type ShapeWalk,
} from "../shape";

export type ManiaHand = "Left" | "Right" | "Both";

export type ManiaDifficultyHitObject = {
  Column: number;
  ColumnDelta: number;
  DeltaTime: number;
  StartTime: number;
  EndTime: number;
  Index: number;
  ManipulationFactor: number;
  EnduranceFactor: number;
  /** Long notes held at this hit, as a multiplier of at least 1. */
  HeldNoteMultiplier: number;
  IsHoldNote: boolean;
  BaseObject: { IsHoldNote: boolean };
  Row: ManiaRow;
  PreviousHitObjects: Array<ManiaDifficultyHitObject | null>;
  ChordHitObjects: Array<ManiaDifficultyHitObject | null>;
  HeadOverlappedHolds: Array<ManiaDifficultyHitObject | null>;
  TailOverlappedHolds: Array<ManiaDifficultyHitObject | null>;
  TailChordHolds: Array<ManiaDifficultyHitObject | null>;
  LastConcurrentlyReleasedHolds: Array<ManiaDifficultyHitObject | null>;
  Previous: (skip?: number) => ManiaDifficultyHitObject | null;
  PrevInColumn: (back?: number) => ManiaDifficultyHitObject | null;
  PrevInColumnBefore: (
    column: number,
    afterIndex: number,
  ) => ManiaDifficultyHitObject | null;
  NextInColumn: (forward?: number) => ManiaDifficultyHitObject | null;
  LastStartTimeInColumn: (column: number) => number;
  LastEndTimeInColumn: (column: number) => number;
  ConcurrentlyHeldColumns: (chordTolerance: number) => number;
};

export type ManiaRow = {
  Columns: number[];
  StartTime: number;
  Size: number;
  TotalColumns: number;
  GapBefore: number;
  Objects: ManiaDifficultyHitObject[];
  RowIndex: number;
  Hand: ManiaHand;
  IsHandLocal: boolean;
  IsChord: boolean;
  IsSingleNote: boolean;
  IsJump: boolean;
  LocalPulse: number;
  Previous: (skip?: number) => ManiaRow | null;
  Next: (skip?: number) => ManiaRow | null;
  Offset: (offset: number) => ManiaRow | null;
  RowsAround: (radius: number) => Iterable<ManiaRow>;
  RowsUpTo: (last: ManiaRow) => Iterable<ManiaRow>;
  RowsWithin: (radiusMs: number, center: number) => Iterable<ManiaRow>;
  FirstWithin: (radiusMs: number) => ManiaRow;
  LastWithin: (radiusMs: number) => ManiaRow;
  Contains: (column: number) => boolean;
  IsSameRow: (other: ManiaRow) => boolean;
  ChordDensity: (radius?: number) => number;
  CrossHandDensity: (radius?: number) => number;
  SingleHandChordDensity: (radius?: number) => number;
  LargeChordDensity: (radius?: number) => number;
};

export type ManiaChain = {
  First: ManiaRow;
  Last: ManiaRow;
  Length: number;
  RowCount: number;
  NoteCount: number;
  Rows: Iterable<ManiaRow>;
  RowsAfterFirst: Iterable<ManiaRow>;
  JoinedWith: (other: ManiaChain) => ManiaChain;
};

function handOf(columns: number[], totalColumns: number): ManiaHand {
  let hasLeft = false;
  let hasRight = false;
  for (const column of columns) {
    if (column < Math.floor(totalColumns / 2)) hasLeft = true;
    else if (column >= Math.floor((totalColumns + 1) / 2)) hasRight = true;
  }
  if (hasLeft && hasRight) return "Both";
  return hasRight ? "Right" : "Left";
}

function makeChain(first: ManiaRow, last: ManiaRow, length: number): ManiaChain {
  const rowCount = last.RowIndex - first.RowIndex + 1;
  let noteCount = 0;
  for (const r of first.RowsUpTo(last)) noteCount += r.Size;
  return {
    First: first,
    Last: last,
    Length: length,
    RowCount: rowCount,
    NoteCount: noteCount,
    get Rows() {
      return first.RowsUpTo(last);
    },
    get RowsAfterFirst() {
      const n = first.Next();
      if (!n || n.RowIndex > last.RowIndex) return [] as ManiaRow[];
      return n.RowsUpTo(last);
    },
    JoinedWith(other) {
      const f =
        first.RowIndex <= other.First.RowIndex ? first : other.First;
      const l = last.RowIndex >= other.Last.RowIndex ? last : other.Last;
      return makeChain(f, l, length + other.Length);
    },
  };
}

type MapData = {
  TotalColumns: number;
  rows: ManiaRow[];
  localPulses: number[];
  rowKindCounts: number[][];
  RowAt: (index: number) => ManiaRow | null;
  LocalPulseAt: (index: number) => number;
  density: (kind: number, index: number, radius: number) => number;
};

type HitMutable = ManiaDifficultyHitObject & {
  _all: ManiaDifficultyHitObject[];
  _col: ManiaDifficultyHitObject[][];
  _colIdx: number;
};

/**
 * Shared row methods. One prototype for every row — a per-row closure captured
 * the whole row list and was the bulk of a chart's live set.
 */
class RowImpl implements ManiaRow {
  Columns!: number[];
  StartTime = 0;
  Size = 0;
  TotalColumns = 0;
  GapBefore = Number.POSITIVE_INFINITY;
  Objects!: ManiaDifficultyHitObject[];
  RowIndex = 0;
  Hand: ManiaHand = "Left";
  IsHandLocal = true;
  IsChord = false;
  IsSingleNote = true;
  IsJump = false;
  _map: MapData | null = null;

  get LocalPulse(): number {
    return this._map?.LocalPulseAt(this.RowIndex) ?? Number.POSITIVE_INFINITY;
  }
  Previous(skip = 0): ManiaRow | null {
    return this._map?.RowAt(this.RowIndex - (skip + 1)) ?? null;
  }
  Next(skip = 0): ManiaRow | null {
    return this._map?.RowAt(this.RowIndex + (skip + 1)) ?? null;
  }
  Offset(offset: number): ManiaRow | null {
    return this._map?.RowAt(this.RowIndex + offset) ?? null;
  }
  RowsAround(radius: number): ManiaRow[] {
    let first: ManiaRow = this;
    while (this.RowIndex - first.RowIndex < radius && first.Previous() != null) {
      first = first.Previous()!;
    }
    const out: ManiaRow[] = [];
    let cur: ManiaRow | null = first;
    while (cur && cur.RowIndex <= this.RowIndex + radius) {
      out.push(cur);
      cur = cur.Next();
    }
    return out;
  }
  RowsUpTo(last: ManiaRow): ManiaRow[] {
    const out: ManiaRow[] = [];
    let cur: ManiaRow | null = this;
    while (cur && cur.RowIndex <= last.RowIndex) {
      out.push(cur);
      cur = cur.Next();
    }
    return out;
  }
  RowsWithin(radiusMs: number, center: number): ManiaRow[] {
    const out: ManiaRow[] = [this];
    for (
      let earlier = this.Previous();
      earlier != null && center - earlier.StartTime <= radiusMs;
      earlier = earlier.Previous()
    ) {
      out.push(earlier);
    }
    for (
      let later = this.Next();
      later != null && later.StartTime - center <= radiusMs;
      later = later.Next()
    ) {
      out.push(later);
    }
    return out;
  }
  FirstWithin(radiusMs: number): ManiaRow {
    let first: ManiaRow = this;
    while (
      first.Previous() != null &&
      this.StartTime - first.Previous()!.StartTime <= radiusMs
    ) {
      first = first.Previous()!;
    }
    return first;
  }
  LastWithin(radiusMs: number): ManiaRow {
    let last: ManiaRow = this;
    while (
      last.Next() != null &&
      last.Next()!.StartTime - this.StartTime <= radiusMs
    ) {
      last = last.Next()!;
    }
    return last;
  }
  Contains(column: number): boolean {
    return this.Columns.includes(column);
  }
  IsSameRow(other: ManiaRow): boolean {
    return other.RowIndex === this.RowIndex;
  }
  ChordDensity(radius = DEFAULT_DENSITY_RADIUS): number {
    return this._map?.density(KIND_CHORD, this.RowIndex, radius) ?? 0;
  }
  CrossHandDensity(radius = DEFAULT_DENSITY_RADIUS): number {
    return this._map?.density(KIND_CROSS, this.RowIndex, radius) ?? 0;
  }
  SingleHandChordDensity(radius = DEFAULT_DENSITY_RADIUS): number {
    return (
      this._map?.density(KIND_SINGLE_HAND_CHORD, this.RowIndex, radius) ?? 0
    );
  }
  LargeChordDensity(radius = DEFAULT_DENSITY_RADIUS): number {
    return this._map?.density(KIND_LARGE, this.RowIndex, radius) ?? 0;
  }
}

/** Shared hit-object methods. One copy for the whole process, not one per note. */
const hitProto = {
  Previous(this: HitMutable, skip = 0): ManiaDifficultyHitObject | null {
    const j = this.Index - (skip + 1);
    return j >= 0 ? this._all[j]! : null;
  },
  PrevInColumn(this: HitMutable, back = 0): ManiaDifficultyHitObject | null {
    const list = this._col[this.Column]!;
    const j = this._colIdx - (back + 1);
    return j >= 0 ? list[j]! : null;
  },
  PrevInColumnBefore(
    this: HitMutable,
    column: number,
    afterIndex: number,
  ): ManiaDifficultyHitObject | null {
    const list = this._col[column];
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const obj = list[i]!;
      if (obj.Index < afterIndex) return obj;
    }
    return null;
  },
  NextInColumn(this: HitMutable, forward = 0): ManiaDifficultyHitObject | null {
    const list = this._col[this.Column]!;
    const j = this._colIdx + (forward + 1);
    return j < list.length ? list[j]! : null;
  },
  LastStartTimeInColumn(this: HitMutable, column: number): number {
    return this.PreviousHitObjects[column]?.StartTime ?? Number.NEGATIVE_INFINITY;
  },
  LastEndTimeInColumn(this: HitMutable, column: number): number {
    return this.PreviousHitObjects[column]?.EndTime ?? Number.NEGATIVE_INFINITY;
  },
  ConcurrentlyHeldColumns(this: HitMutable, chordTolerance: number): number {
    let held = 0;
    for (let c = 0; c < this.PreviousHitObjects.length; c++) {
      if (c === this.Column) continue;
      if (
        Math.abs(this.LastStartTimeInColumn(c) - this.StartTime) <=
        chordTolerance
      ) {
        continue;
      }
      if (this.LastEndTimeInColumn(c) > this.StartTime + chordTolerance) held++;
    }
    return held;
  },
};

function noteMemory(shouldContinue: (() => boolean) | undefined, index: number): void {
  if (
    shouldContinue &&
    index % GRAPH_CHECK_EVERY === 0 &&
    !shouldContinue()
  ) {
    throw new ChartMemoryError();
  }
}

const KIND_CHORD = 0;
const KIND_CROSS = 1;
const KIND_SINGLE_HAND_CHORD = 2;
const KIND_LARGE = 3;
const DEFAULT_DENSITY_RADIUS = 14;

/** Notes between in-map memory checks. One chunk must not be able to reach the heap limit. */
export const GRAPH_CHECK_EVERY = 128;

/**
 * Thrown when a backfill asks the calculator to stop mid-chart.
 *
 * The partial graph is released before this is thrown, and the error itself
 * holds no note list, so the caller can persist a failed row and pause.
 */
export class ChartMemoryError extends Error {
  constructor() {
    super("Chart exceeded the backfill memory ceiling");
    this.name = "ChartMemoryError";
  }
}

export function isChartMemoryError(err: unknown): err is ChartMemoryError {
  return (
    err instanceof ChartMemoryError ||
    (err instanceof Error && err.name === "ChartMemoryError")
  );
}

function buildMapData(
  objects: ManiaDifficultyHitObject[],
  totalColumns: number,
  shouldContinue?: () => boolean,
): MapData {
  const rows: ManiaRow[] = [];
  const data: MapData = {
    TotalColumns: totalColumns,
    rows,
    localPulses: [],
    rowKindCounts: [[], [], [], []],
    RowAt(index) {
      return index >= 0 && index < rows.length ? rows[index]! : null;
    },
    LocalPulseAt(index) {
      return data.localPulses[index] ?? Number.POSITIVE_INFINITY;
    },
    density(kind, index, radius) {
      const counts = data.rowKindCounts[kind]!;
      const lo = Math.max(0, index - radius);
      const hi = Math.min(rows.length - 1, index + radius);
      return (counts[hi + 1]! - counts[lo]!) / (hi - lo + 1);
    },
  };

  // group into rows
  let i = 0;
  while (i < objects.length) {
    const rowStart = objects[i]!.StartTime;
    const members: ManiaDifficultyHitObject[] = [];
    while (
      i < objects.length &&
      Math.abs(objects[i]!.StartTime - rowStart) <= ChordUtils.CHORD_TOLERANCE_MS
    ) {
      members.push(objects[i]!);
      i++;
    }
    const columns = [...new Set(members.map((m) => m.Column))].sort(
      (a, b) => a - b,
    );
    noteMemory(shouldContinue, rows.length);
    const rowIndex = rows.length;
    const hand = handOf(columns, totalColumns);

    const row = new RowImpl();
    row.Columns = columns;
    row.StartTime = rowStart;
    row.Size = columns.length;
    row.TotalColumns = totalColumns;
    row.Objects = members;
    row.RowIndex = rowIndex;
    row.Hand = hand;
    row.IsHandLocal = hand !== "Both";
    row.IsChord = columns.length > 1;
    row.IsSingleNote = columns.length === 1;
    row.IsJump = columns.length === 2;
    row._map = data;

    for (const m of members) m.Row = row;
    rows.push(row);
  }

  for (let r = 1; r < rows.length; r++) {
    (rows[r] as { GapBefore: number }).GapBefore =
      rows[r]!.StartTime - rows[r - 1]!.StartTime;
  }

  // local pulses (median gap)
  const pulse_radius = 16;
  data.localPulses = new Array(rows.length);
  for (let idx = 0; idx < rows.length; idx++) {
    const lo = Math.max(1, idx - pulse_radius);
    const hi = Math.min(rows.length - 1, idx + pulse_radius);
    const length = hi - lo + 1;
    if (length <= 0) {
      data.localPulses[idx] = Number.POSITIVE_INFINITY;
      continue;
    }
    const window: number[] = [];
    for (let k = 0; k < length; k++) {
      window.push(rows[lo + k]!.StartTime - rows[lo + k - 1]!.StartTime);
    }
    window.sort((a, b) => a - b);
    data.localPulses[idx] = window[Math.floor((length - 1) / 2)]!;
  }

  // prefix counts for densities
  const isKind = (row: ManiaRow, kind: number) => {
    switch (kind) {
      case KIND_CHORD:
        return row.IsChord;
      case KIND_CROSS:
        return row.Hand === "Both";
      case KIND_SINGLE_HAND_CHORD:
        return row.Hand !== "Both" && row.Size >= 2;
      case KIND_LARGE:
        return row.Size >= 3;
      default:
        return false;
    }
  };
  for (let kind = 0; kind < 4; kind++) {
    const counts = new Array(rows.length + 1).fill(0);
    for (let r = 0; r < rows.length; r++) {
      counts[r + 1] = counts[r]! + (isKind(rows[r]!, kind) ? 1 : 0);
    }
    data.rowKindCounts[kind] = counts;
  }

  return data;
}

// --- Manipulation detectors ---

function stepContinuity(gap: number, pulse: number): number {
  if (!(pulse > 0) || !Number.isFinite(pulse)) return 0;
  return DiffUtils.Smoothstep(gap / pulse, 2.2, 1.5);
}

/**
 * Chain summary for one direction out of `seed`.
 *
 * Only scalars are accumulated — the previous chain object materialised a row
 * array and re-summed note counts for every walk, which dominated the
 * preprocessor. `first`/`last` are the chain bounds.
 */
type ChainStats = {
  first: ManiaRow;
  last: ManiaRow;
  length: number;
  rowCount: number;
  noteCount: number;
};

function walkChain(
  seed: ManiaRow,
  backwards: boolean,
  lengthCap: number,
  rowCap: number,
  continues: (
    cameFrom: ManiaRow | null,
    from: ManiaRow,
    to: ManiaRow,
  ) => boolean,
): ChainStats {
  const pulse = seed.LocalPulse;
  let length = 0;
  let steps = 0;
  let weakestStep = 1.0;
  let noteCount = seed.Size;
  let cameFrom: ManiaRow | null = null;
  let end = seed;

  while (length < lengthCap && steps < rowCap) {
    const next = backwards ? end.Previous() : end.Next();
    if (next == null || !continues(cameFrom, end, next)) break;
    const step = stepContinuity(Math.abs(next.StartTime - end.StartTime), pulse);
    if (step <= 0) break;
    if (step < weakestStep) weakestStep = step;
    length += weakestStep;
    noteCount += next.Size;
    steps++;
    cameFrom = end;
    end = next;
  }

  const first = backwards ? end : seed;
  const last = backwards ? seed : end;
  return {
    first,
    last,
    length,
    rowCount: last.RowIndex - first.RowIndex + 1,
    noteCount,
  };
}

/** Merge two opposite-direction walks into one span, as `JoinedWith` did. */
function joinChainStats(left: ChainStats, right: ChainStats): ChainStats {
  const f = left.first.RowIndex <= right.first.RowIndex ? left.first : right.first;
  const l = left.last.RowIndex >= right.last.RowIndex ? left.last : right.last;
  return {
    first: f,
    last: l,
    length: left.length + right.length,
    rowCount: l.RowIndex - f.RowIndex + 1,
    noteCount: left.noteCount + right.noteCount - f.Size,
  };
}

/** Continuation predicates hoisted out of the per-row hot path. */
const continuesHandLocal = (_c: ManiaRow | null, _f: ManiaRow, to: ManiaRow) =>
  to.IsHandLocal;
const continuesAlways = () => true;

function plateauOf(row: ManiaRow, onset: number, strength: number): number {
  const offset_ms = 75.0;
  const gap = row.GapBefore;
  if (strength <= 0 || gap >= onset) return 1.0;
  const ratio = (gap + offset_ms) / (onset + offset_ms);
  return Math.pow(ratio, Math.min(strength, 1.0));
}

function mashStrength(row: ManiaRow): number {
  if (!row.IsHandLocal) return 0;
  const runWeight = DiffUtils.Smoothstep(
    walkChain(row, true, Infinity, 64, continuesHandLocal).length,
    3,
    9,
  );
  if (runWeight <= 0) return 0;
  const chordGate = DiffUtils.Smoothstep(row.ChordDensity(), 0.06, 0.18);
  const crossHandGate = DiffUtils.Smoothstep(row.CrossHandDensity(), 0.22, 0.1);
  return runWeight * chordGate * crossHandGate;
}

function crossHandMashStrength(row: ManiaRow): number {
  const crossHandGate = DiffUtils.Smoothstep(row.CrossHandDensity(), 0.14, 0.32);
  if (crossHandGate <= 0) return 0;
  const runLength =
    walkChain(row, true, Infinity, 128, continuesAlways).length +
    walkChain(row, false, Infinity, 128, continuesAlways).length;
  const runWeight = DiffUtils.Smoothstep(runLength, 3, 10);
  if (runWeight <= 0) return 0;
  const largeChordGate = DiffUtils.Smoothstep(row.LargeChordDensity(), 0.16, 0.05);
  return runWeight * crossHandGate * largeChordGate;
}

// Jumptrill
type JumpStep = "Break" | "Roll" | "JumpSwitch" | "SingleSwitch";
function jumpStepBetween(from: ManiaRow, to: ManiaRow): JumpStep {
  if (from.Hand !== to.Hand) {
    return from.Size >= 2 || to.Size >= 2 ? "JumpSwitch" : "SingleSwitch";
  }
  return from.IsSingleNote &&
    to.IsSingleNote &&
    Math.abs(from.Columns[0]! - to.Columns[0]!) === 1
    ? "Roll"
    : "Break";
}
function jumptrillContinues(
  cameFrom: ManiaRow | null,
  from: ManiaRow,
  to: ManiaRow,
): boolean {
  if (!to.IsHandLocal) return false;
  const step = jumpStepBetween(from, to);
  if (step === "Roll" || step === "JumpSwitch") return true;
  if (step === "SingleSwitch") {
    return cameFrom != null && jumpStepBetween(cameFrom, from) === "Roll";
  }
  return false;
}
function recursAt(row: ManiaRow, offset: number): boolean {
  const recurrence = row.Offset(offset);
  const between = row.Offset(Math.trunc(offset / 2));
  if (!recurrence || !between) return false;
  return ColumnPatternUtils.IsRecurrence(
    recurrence.Columns,
    between.Columns,
    row.Columns,
  );
}
function isStrictJumptrill(row: ManiaRow): boolean {
  if (!row.IsJump) return false;
  return recursAt(row, -2) || recursAt(row, 2);
}
function jumptrillStrength(row: ManiaRow): number {
  if (!row.IsHandLocal) return 0;
  const chainLen =
    1 +
    walkChain(row, true, Infinity, 200, jumptrillContinues).length +
    walkChain(row, false, Infinity, 200, jumptrillContinues).length;
  const runWeight = DiffUtils.Smoothstep(chainLen, 3, 8);
  if (runWeight <= 0) return 0;
  const crossHandGate = Math.max(
    DiffUtils.Smoothstep(row.CrossHandDensity(), 0.16, 0.06),
    isStrictJumptrill(row) ? 0.55 : 0,
  );
  const jumpGate =
    DiffUtils.Smoothstep(row.SingleHandChordDensity(32), 0.05, 0.11) *
    DiffUtils.Smoothstep(row.SingleHandChordDensity(6), 0.05, 0.2);
  return runWeight * crossHandGate * jumpGate;
}

// Roll detector (simplified but structure-faithful)
function isNarrowTrill(row: ManiaRow): boolean {
  const window = 4;
  let firstColumn = -1;
  let secondColumn = -1;
  let counted = 0;
  for (
    let current: ManiaRow | null = row;
    counted < window && current != null;
    current = current.Previous()
  ) {
    if (!current.IsSingleNote) return false;
    const column = current.Columns[0]!;
    counted++;
    if (column === firstColumn || column === secondColumn) continue;
    if (firstColumn < 0) firstColumn = column;
    else if (secondColumn < 0) secondColumn = column;
    else return false;
  }
  return (
    counted >= window &&
    secondColumn >= 0 &&
    Math.abs(firstColumn - secondColumn) === 1
  );
}
function shiftRunLength(row: ManiaRow): number {
  let steps = 0;
  for (
    let current = row;
    steps < 90 &&
    current.Previous() != null &&
    ColumnPatternUtils.IsRoll(current.Previous()!.Columns, current.Columns);
    current = current.Previous()!
  ) {
    steps++;
  }
  return steps;
}
function repeatRunLength(row: ManiaRow, period: number): number {
  let steps = 0;
  for (
    let current = row;
    steps < 90 &&
    current.Offset(-period) != null &&
    ColumnPatternUtils.SameColumns(
      current.Columns,
      current.Offset(-period)!.Columns,
    );
    current = current.Offset(-period)!
  ) {
    steps++;
  }
  return steps;
}
function shiftOrRepeatRunLength(row: ManiaRow): number {
  if (isNarrowTrill(row)) return 0;
  let run = shiftRunLength(row);
  for (let period = 2; period <= 4; period++) {
    run = Math.max(run, repeatRunLength(row, period));
  }
  return run;
}
function rollContinues(
  _cameFrom: ManiaRow | null,
  from: ManiaRow,
  to: ManiaRow,
): boolean {
  return from.IsSingleNote && to.IsSingleNote && from.Columns[0] !== to.Columns[0];
}
function stepRepetitionAround(row: ManiaRow): number {
  const totalColumns = row.TotalColumns;
  if (totalColumns < 3) return 1;
  const stepCounts = new Array(totalColumns).fill(0);
  let steps = 0;
  for (const current of row.RowsAround(8)) {
    if (
      !current.IsSingleNote ||
      current.Previous() == null ||
      !current.Previous()!.IsSingleNote
    ) {
      continue;
    }
    const previous = current.Previous()!;
    let step =
      (current.Columns[0]! - previous.Columns[0]! + totalColumns) % totalColumns;
    if (step === 0) continue;
    stepCounts[step]++;
    steps++;
  }
  if (steps === 0) return 1;
  let mostUsed = 0;
  for (const c of stepCounts) mostUsed = Math.max(mostUsed, c);
  const chanceShare = 1.0 / (totalColumns - 1);
  return Math.max(0, (mostUsed / steps - chanceShare) / (1 - chanceShare));
}
function directionConsistencyOf(lateral: ChainStats): number {
  let directedPairs = 0;
  let sameDirectionPairs = 0;
  let previousDirection = 0;
  // Rows after the first, matching the chain's previous RowsAfterFirst.
  let row = lateral.first.Next();
  while (row != null && row.RowIndex <= lateral.last.RowIndex) {
    const prev = row.Previous();
    if (prev) {
      const direction = Math.sign(row.Columns[0]! - prev.Columns[0]!);
      if (previousDirection !== 0) {
        directedPairs++;
        if (direction === previousDirection) sameDirectionPairs++;
      }
      previousDirection = direction;
    }
    row = row.Next();
  }
  return directedPairs > 0 ? sameDirectionPairs / directedPairs : 0;
}
function rollStrength(row: ManiaRow): number {
  const run_ramp = 26.0;
  let runWeight = DiffUtils.ReverseLerp(shiftOrRepeatRunLength(row), 0, run_ramp);
  const lateral = joinChainStats(
    walkChain(row, true, Infinity, 400, rollContinues),
    walkChain(row, false, Infinity, 400, rollContinues),
  );
  if (lateral.rowCount >= 2) {
    const rollGate =
      DiffUtils.Smoothstep(directionConsistencyOf(lateral), 0.42, 0.5) *
      DiffUtils.Smoothstep(stepRepetitionAround(row), 0.22, 0.78);
    runWeight = Math.max(
      runWeight,
      DiffUtils.ReverseLerp(lateral.rowCount, 0, run_ramp) * rollGate,
    );
  }
  runWeight *= DiffUtils.Smoothstep(row.ChordDensity(), 0.34, 0.14);
  return 0.86 * runWeight;
}

/** Vibro continuation: the walked row must contain `column`. */
function vibroContinues(
  column: number,
  _c: ManiaRow | null,
  _f: ManiaRow,
  to: ManiaRow,
): boolean {
  return to.Contains(column);
}

function vibroFactor(row: ManiaRow, column: number): number {
  const onset = 190;
  if (row.GapBefore >= onset) return 1;
  const continues = (
    _c: ManiaRow | null,
    _f: ManiaRow,
    to: ManiaRow,
  ) => vibroContinues(column, _c, _f, to);
  const back = walkChain(row, true, Infinity, 63, continues);
  const remaining = 64 - back.rowCount;
  const chain = joinChainStats(
    back,
    walkChain(row, false, Infinity, remaining, continues),
  );
  const runWeight = DiffUtils.Smoothstep(chain.rowCount, 2.5, 5.0);
  const rowSizeGate = DiffUtils.Smoothstep(
    chain.noteCount / chain.rowCount,
    2.6,
    1.6,
  );
  return plateauOf(row, onset, runWeight * rowSizeGate);
}

function enduranceFactor(row: ManiaRow): number {
  const window_ms = 250.0;
  const first = row.FirstWithin(window_ms);
  const last = row.LastWithin(window_ms);
  let rowCount = 0;
  let noteCount = 0;
  let revisitingRows = 0;
  let singleNoteRows = 0;

  const revisitsRecentColumn = (r: ManiaRow) => {
    for (let back = 1; back <= 2; back++) {
      const earlier = r.Offset(-back);
      if (!earlier) return false;
      if (ColumnPatternUtils.SharesColumn(r.Columns, earlier.Columns)) return true;
    }
    return false;
  };

  for (const current of first.RowsUpTo(last)) {
    rowCount++;
    noteCount += current.Size;
    if (revisitsRecentColumn(current)) revisitingRows++;
    if (current.IsSingleNote) singleNoteRows++;
  }
  if (rowCount < 3) return 1;

  const notesPerSecond = noteCount / ((2.0 * window_ms) / 1000.0);
  const rateGate = DiffUtils.Smoothstep(notesPerSecond, 16, 26);
  if (rateGate <= 0) return 1;
  const streamGate = DiffUtils.Smoothstep(singleNoteRows / rowCount, 0.2, 0.42);
  if (streamGate <= 0) return 1;
  const breadthGate = DiffUtils.Smoothstep(revisitingRows / rowCount, 0.2, 0.32);
  const ceilingFade = DiffUtils.Smoothstep(notesPerSecond, 44, 33);

  // burstiness
  const pulse_window_ms = 600;
  const gaps: number[] = [];
  for (
    let current = row.Previous();
    current != null &&
    gaps.length < 128 &&
    row.StartTime - current.StartTime <= pulse_window_ms;
    current = current.Previous()
  ) {
    const n = current.Next();
    if (n) gaps.push(n.GapBefore);
  }
  for (
    let current = row.Next();
    current != null &&
    gaps.length < 128 &&
    current.StartTime - row.StartTime <= pulse_window_ms;
    current = current.Next()
  ) {
    gaps.push(current.GapBefore);
  }
  let burstShare = 0;
  if (gaps.length > 0) {
    gaps.sort((a, b) => a - b);
    const burstThreshold = 0.75 * gaps[Math.floor(gaps.length / 2)]!;
    let bursts = 0;
    const start = first.Next();
    if (start) {
      for (const current of start.RowsUpTo(last)) {
        if (current.GapBefore < burstThreshold) bursts++;
      }
    }
    burstShare = DiffUtils.Smoothstep(bursts / (rowCount - 1), 0.03, 0.14);
  }

  const reward = 0.13 * ceilingFade * breadthGate * (1.0 - burstShare);
  return 1.0 + rateGate * streamGate * (reward - 0.1 * burstShare);
}

function applyPatternContext(mapData: MapData): void {
  for (const row of mapData.rows) {
    let manipulation = 1.0;
    const onsetMash = 60;
    const onsetCross = 64;
    const onsetJump = 260;
    const onsetRoll = 260;

    if (row.GapBefore < onsetRoll) {
      manipulation = Math.min(manipulation, plateauOf(row, onsetRoll, rollStrength(row)));
    }
    if (row.GapBefore < onsetJump) {
      manipulation = Math.min(
        manipulation,
        plateauOf(row, onsetJump, jumptrillStrength(row)),
      );
    }
    if (row.GapBefore < onsetMash) {
      manipulation = Math.min(manipulation, plateauOf(row, onsetMash, mashStrength(row)));
    }
    if (row.GapBefore < onsetCross) {
      manipulation = Math.min(
        manipulation,
        plateauOf(row, onsetCross, crossHandMashStrength(row)),
      );
    }

    const endurance = enduranceFactor(row);

    for (const note of row.Objects) {
      let noteManipulation = Math.min(manipulation, vibroFactor(row, note.Column));
      if (noteManipulation < 1.0) note.ManipulationFactor = noteManipulation;
      note.EnduranceFactor = endurance;
    }
  }

  assignHeldNoteMultipliers(mapData);
}

const HOLD_WEIGHT = 0.78;
const HOLD_RAMP_MS = 600.0;
const HOLD_END_RAMP_MS = 110.0;
const HOLD_EDGE_FACTOR = 0.4;
const SHORT_HOLD_MS = 110.0;
const SHORT_HOLD_STEEPNESS = 0.07;
/** Distant holds interfere less than neighbouring holds. */
const HOLD_COLUMN_FALLOFF = 0.12;

/** Port of HeldNoteMultiplier.ProcessAndAssign. */
function assignHeldNoteMultipliers(mapData: MapData): void {
  for (const row of mapData.rows) {
    for (const note of row.Objects) {
      note.HeldNoteMultiplier = evaluateHeldNoteMultiplier(note);
    }
  }
}

function evaluateHeldNoteMultiplier(current: ManiaDifficultyHitObject): number {
  let pressure = 0;
  const holds = current.HeadOverlappedHolds;
  for (let column = 0; column < holds.length; column++) {
    const hold = holds[column];
    if (hold == null) continue;
    const distanceWeight =
      1.0 / (1.0 + HOLD_COLUMN_FALLOFF * Math.abs(column - current.Column));
    pressure +=
      heldNoteFactor(hold.StartTime, hold.EndTime, current.StartTime) *
      distanceWeight;
  }
  // A hold in this very row has only just been pressed, so it counts as the smallest amount.
  if (current.BaseObject.IsHoldNote) {
    pressure += heldNoteFactor(current.StartTime, current.EndTime, current.StartTime);
  }
  return 1.0 + HOLD_WEIGHT * pressure;
}

function heldNoteFactor(startTime: number, endTime: number, time: number): number {
  const heldFor = time - startTime;
  const stillToGo = endTime - time;
  if (heldFor < 0.0 || stillToGo < 0.0) return 0.0;
  const rampIn = DiffUtils.Smoothstep(heldFor, 0.0, HOLD_RAMP_MS);
  const rampOut = DiffUtils.Smoothstep(stillToGo, 0.0, HOLD_END_RAMP_MS);
  const shortHoldGate = DiffUtils.Logistic(
    endTime - startTime,
    SHORT_HOLD_MS,
    SHORT_HOLD_STEEPNESS,
  );
  return (HOLD_EDGE_FACTOR + (1.0 - HOLD_EDGE_FACTOR) * rampIn * rampOut) * shortHoldGate;
}

/**
 * Build difficulty hit objects matching C# CreateDifficultyHitObjects:
 * starts at note index 1 (first chart note is only LastObject of the first DHO).
 */
export function buildHitObjectGraph(
  columnCount: number,
  notes: Array<{ column: number; startMs: number; endMs: number }>,
  clockRate = 1,
  shouldContinue?: () => boolean,
): ManiaDifficultyHitObject[] {
  const sorted = [...notes].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );
  if (sorted.length < 2) return [];

  const perColumn: HitMutable[][] = Array.from({ length: columnCount }, () => []);
  const objects: HitMutable[] = [];
  const emptyCols = () =>
    Array.from({ length: columnCount }, () => null as ManiaDifficultyHitObject | null);

  try {
  return buildHitObjectGraphBody(
    columnCount,
    sorted,
    clockRate,
    shouldContinue,
    perColumn,
    objects,
    emptyCols,
  );
  } catch (err) {
    releaseHitObjectGraph(objects);
    throw err;
  }
}

function buildHitObjectGraphBody(
  columnCount: number,
  sorted: Array<{ column: number; startMs: number; endMs: number }>,
  clockRate: number,
  shouldContinue: (() => boolean) | undefined,
  perColumn: HitMutable[][],
  objects: HitMutable[],
  emptyCols: () => Array<ManiaDifficultyHitObject | null>,
): ManiaDifficultyHitObject[] {

  // C#: for i = 1 .. n-1
  for (let i = 1; i < sorted.length; i++) {
    noteMemory(shouldContinue, i - 1);
    const n = sorted[i]!;
    const last = sorted[i - 1]!;
    const start = n.startMs / clockRate;
    const end = Math.max(n.endMs, n.startMs) / clockRate;
    const lastStart = last.startMs / clockRate;
    const isHold = n.endMs > n.startMs;
    const idx = objects.length;
    const colList = perColumn[n.column]!;
    const colIdx = colList.length;

    let PreviousHitObjects = emptyCols();
    let ChordHitObjects = emptyCols();
    let HeadOverlappedHolds = emptyCols();
    const TailOverlappedHolds = emptyCols();
    const TailChordHolds = emptyCols();

    if (idx > 0) {
      const prevNote = objects[idx - 1]!;
      const sameChord = prevNote.StartTime === start;
      PreviousHitObjects = sameChord
        ? prevNote.PreviousHitObjects
        : [...prevNote.PreviousHitObjects];
      ChordHitObjects = sameChord ? prevNote.ChordHitObjects : emptyCols();
      HeadOverlappedHolds = sameChord ? prevNote.HeadOverlappedHolds : emptyCols();

      if (!sameChord) {
        // updateChordRelationsOf
        for (let c = 0; c < columnCount; c++) {
          if (prevNote.ChordHitObjects[c] != null) {
            PreviousHitObjects[c] = prevNote.ChordHitObjects[c];
          }
        }
        for (const prevObj of PreviousHitObjects) {
          if (prevObj == null) continue;
          if (prevObj.StartTime < start && prevObj.EndTime > start) {
            HeadOverlappedHolds[prevObj.Column] = prevObj;
          }
        }
      }
    }

    const LastConcurrentlyReleasedHolds = HeadOverlappedHolds.map((o) =>
      o && o.EndTime > end ? null : o,
    );

    const obj = Object.assign(Object.create(hitProto), {
      Column: n.column,
      ColumnDelta: 0,
      DeltaTime: start - lastStart,
      StartTime: start,
      EndTime: end,
      Index: idx,
      ManipulationFactor: 1,
      EnduranceFactor: 1,
      HeldNoteMultiplier: 1,
      IsHoldNote: isHold,
      BaseObject: { IsHoldNote: isHold },
      Row: null as unknown as ManiaRow,
      PreviousHitObjects,
      ChordHitObjects,
      HeadOverlappedHolds,
      TailOverlappedHolds,
      TailChordHolds,
      LastConcurrentlyReleasedHolds,
      _all: objects,
      _col: perColumn,
      _colIdx: colIdx,
    }) as HitMutable;

    // C#: ColumnDelta = StartTime - PrevInColumn(0)?.StartTime ?? StartTime
    // Precedence: (StartTime - nullable) ?? StartTime — missing prev → ColumnDelta = StartTime (large).
    const prevInCol = colList.length > 0 ? colList[colList.length - 1] : null;
    obj.ColumnDelta =
      prevInCol != null ? start - prevInCol.StartTime : start;

    // Tail overlaps
    for (const prevHitObj of PreviousHitObjects) {
      if (prevHitObj == null || prevHitObj.EndTime <= end) continue;
      TailOverlappedHolds[prevHitObj.Column] = prevHitObj;
      prevHitObj.LastConcurrentlyReleasedHolds[n.column] = obj;
    }

    if (idx > 0) {
      const prevNote = objects[idx - 1]!;
      if (prevNote.StartTime !== start) {
        for (const prevObj of PreviousHitObjects) {
          if (prevObj == null) continue;
          if (prevObj.EndTime === end) {
            prevObj.TailChordHolds[n.column] = obj;
            TailChordHolds[prevObj.Column] = prevObj;
          } else if (prevObj.EndTime > start && prevObj.EndTime < end) {
            prevObj.TailOverlappedHolds[n.column] = obj;
          }
        }
      }
    }

    ChordHitObjects[n.column] = obj;
    objects.push(obj);
    colList.push(obj);
  }

  const mapData = buildMapData(objects, columnCount, shouldContinue);
  applyPatternContext(mapData);

  return objects;
}

/**
 * Sever the links that make the hit-object graph one large object cycle.
 *
 * Every note points at the whole note list (`_all`), the per-column lists
 * (`_col`), its row (which owns the row list), and up to six sibling arrays.
 * Nothing outside this graph should still read it once the calculation is done,
 * so clearing those fields makes a finished map collectable immediately instead
 * of waiting for a cycle-collection pass.
 */
export function releaseHitObjectGraph(
  objects: ManiaDifficultyHitObject[],
): void {
  for (const obj of objects) {
    const mutable = obj as unknown as {
      PreviousHitObjects: unknown[];
      ChordHitObjects: unknown[];
      HeadOverlappedHolds: unknown[];
      TailOverlappedHolds: unknown[];
      TailChordHolds: unknown[];
      LastConcurrentlyReleasedHolds: unknown[];
      Row: unknown;
      _all: unknown;
      _col: unknown;
    };
    const row = obj.Row instanceof RowImpl ? obj.Row : null;
    mutable.PreviousHitObjects = [];
    mutable.ChordHitObjects = [];
    mutable.HeadOverlappedHolds = [];
    mutable.TailOverlappedHolds = [];
    mutable.TailChordHolds = [];
    mutable.LastConcurrentlyReleasedHolds = [];
    if (row) {
      row.Objects = [];
      row._map = null;
    }
    mutable.Row = null;
    mutable._all = [];
    mutable._col = [];
  }
}

export function meanManipulation(objects: ManiaDifficultyHitObject[]): number {
  if (objects.length === 0) return 1;
  let sum = 0;
  for (const o of objects) sum += o.ManipulationFactor;
  return sum / objects.length;
}

function rowsInOrder(objects: ManiaDifficultyHitObject[]): ManiaRow[] {
  const rows: ManiaRow[] = [];
  let last = -1;
  for (const obj of objects) {
    const row = obj.Row;
    if (!row || row.RowIndex === last) continue;
    rows.push(row);
    last = row.RowIndex;
  }
  return rows;
}

function sharesColumn(a: ManiaRow, b: ManiaRow): boolean {
  return ColumnPatternUtils.SharesColumn(a.Columns, b.Columns);
}

/** Three dense chords with no jack and no column-shift roll. */
function isBracketWindow(a: ManiaRow, b: ManiaRow, c: ManiaRow): boolean {
  if (a.Size <= 2 || b.Size <= 2 || c.Size <= 2) return false;
  if (a.Size + b.Size + c.Size <= 9) return false;
  if (sharesColumn(a, b) || sharesColumn(b, c)) return false;
  if (ColumnPatternUtils.IsRoll(a.Columns, b.Columns)) return false;
  if (ColumnPatternUtils.IsRoll(b.Columns, c.Columns)) return false;
  return true;
}

function rowInBracket(rows: ManiaRow[], index: number): boolean {
  const windows: Array<[number, number, number]> = [];
  if (index >= 2) windows.push([index - 2, index - 1, index]);
  if (index >= 1 && index + 1 < rows.length) {
    windows.push([index - 1, index, index + 1]);
  }
  if (index + 2 < rows.length) windows.push([index, index + 1, index + 2]);
  return windows.some(([a, b, c]) =>
    isBracketWindow(rows[a]!, rows[b]!, rows[c]!),
  );
}

function besideSingle(row: ManiaRow, other: ManiaRow | undefined): boolean {
  return other != null && other.IsSingleNote && !sharesColumn(row, other);
}

/**
 * One family per row, first match wins.
 *
 * Keymode terms follow the osu! wiki pattern index: jumpstream and handstream
 * are 4K shapes (a stream mixing in jumps/hands), bracket is exclusive to
 * non-4K, and outside 4K chordstream names chords of 3+ notes — a 7K double
 * beside a single is not a jumpstream and stays unlabeled.
 *
 * A jump sitting next to a single is jumpstream (on 4K) even when
 * `jumptrillStrength` also fires: that detector treats every cross-hand jump
 * as a jumptrill step. Jumptrill is reserved for jump rows whose neighbors are
 * not those singles. Single-note trills are claimed before that detector so a
 * two-column alternation stays a trill.
 */
function shapeLabelAt(rows: ManiaRow[], index: number): ShapeLabel | null {
  const row = rows[index]!;
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index + 1 < rows.length ? rows[index + 1] : undefined;
  const is4K = row.TotalColumns === 4;
  const jumpBesideSingle =
    row.IsJump && (besideSingle(row, prev) || besideSingle(row, next));

  if (isNarrowTrill(row)) return "trill";
  if (row.IsJump && jumptrillStrength(row) > 0 && !jumpBesideSingle) {
    return "jumptrill";
  }
  if (row.IsChord && prev?.IsChord && sharesColumn(prev, row)) return "chordjack";
  if (!is4K && rowInBracket(rows, index)) return "bracket";
  if (
    is4K &&
    row.Size === 3 &&
    (prev == null || !sharesColumn(prev, row)) &&
    (next == null || !sharesColumn(row, next))
  ) {
    return "handstream";
  }
  if (jumpBesideSingle && is4K) return "jumpstream";
  if (row.IsChord && prev != null && !sharesColumn(prev, row)) {
    if (is4K || row.Size >= 3) return "chordstream";
  }
  if (row.IsSingleNote && prev != null && !sharesColumn(prev, row)) return "stream";
  return null;
}

function gapsSimilar(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const ratio = a > b ? a / b : b / a;
  return ratio <= 1.5;
}

/**
 * Count chart-shape families on a live hit-object graph.
 *
 * Call before `releaseHitObjectGraph`. The walk is linear and stores only
 * counters. Anchor and shield are counted beside the exclusive families; they
 * do not take a row away from jumpstream, chordjack, or stream.
 */
export function chartShapeWalk(objects: ManiaDifficultyHitObject[]): ShapeWalk {
  const counts = emptyShapeCounts();
  const rows = rowsInOrder(objects);
  let jackSteps = 0;
  let chordRows = 0;
  let totalNotes = 0;
  const columnNotes: number[] = [];
  for (const row of rows) {
    if (row.IsChord) chordRows += 1;
    totalNotes += row.Size;
    for (const column of row.Columns) {
      columnNotes[column] = (columnNotes[column] ?? 0) + 1;
    }
  }
  const anchorWindows: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const row = rows[i]!;
    if (sharesColumn(prev, row)) jackSteps += 1;
    const label = shapeLabelAt(rows, i);
    // Weight by notes in the row so a jump or a 3-note chord outweighs the
    // single sitting next to it. An even jump/single split would otherwise
    // tie as stream.
    if (label) counts[label] += row.Size;
    const next = rows[i + 1];
    if (!next) continue;
    const gapBefore = row.StartTime - prev.StartTime;
    const gapAfter = next.StartTime - row.StartTime;
    if (!gapsSimilar(gapBefore, gapAfter)) continue;
    for (const column of row.Columns) {
      if (!prev.Columns.includes(column) || !next.Columns.includes(column)) continue;
      anchorWindows[column] = (anchorWindows[column] ?? 0) + 1;
    }
  }

  let anchorPairs = 0;
  let anchorColumn = -1;
  for (let column = 0; column < anchorWindows.length; column++) {
    const windows = anchorWindows[column] ?? 0;
    if (windows > anchorPairs) {
      anchorPairs = windows;
      anchorColumn = column;
    }
  }
  counts.anchor = anchorPairs;

  let holdHeads = 0;
  let shieldHits = 0;
  for (const row of rows) {
    const gapCap =
      row.GapBefore === Number.POSITIVE_INFINITY ? 0 : row.GapBefore * 1.5;
    for (const note of row.Objects) {
      if (note.IsHoldNote) holdHeads += 1;
      const prev = note.PrevInColumn(0);
      if (!prev || gapCap <= 0) continue;
      const gap = note.StartTime - prev.EndTime;
      if (gap < 0 || gap > gapCap) continue;
      // Wiki shield: a note immediately before a hold. Reverse shield: a note
      // immediately after a release. Both are the same family.
      if (note.IsHoldNote || prev.IsHoldNote) shieldHits += 1;
    }
  }
  counts.shield = shieldHits;

  return {
    rowCount: rows.length,
    stepCount: Math.max(0, rows.length - 1),
    chordRows,
    jackSteps,
    totalNotes,
    holdHeads,
    shieldHits,
    anchorPairs,
    anchorColumnNotes: anchorColumn >= 0 ? (columnNotes[anchorColumn] ?? 0) : 0,
    counts,
  };
}
