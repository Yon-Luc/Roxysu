import {
  accuracyFromCounts,
  emptyJudgmentCounts,
  judgeError,
  maniaHitWindows,
  type HitWindows,
  type JudgmentCounts,
  type JudgmentResult,
  type JudgmentSummary,
} from "./maniaWindows";

export type LiveNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type LiveJudgment = {
  noteIndex: number;
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  isTail: boolean;
};

export type PracticeRange = {
  fromMs: number;
  toMs: number;
};

type NoteState = {
  index: number;
  column: number;
  startMs: number;
  endMs: number;
  isHold: boolean;
  headJudged: boolean;
  tailJudged: boolean;
  holding: boolean;
};

const HOLD_EPS_MS = 20;

/**
 * Incremental mania judge for live keyboard play.
 * Rules mirror `simulateManiaJudgments` in server `replay/judge.ts`.
 */
export class LiveManiaPlay {
  readonly columnCount: number;
  readonly overallDifficulty: number;
  readonly windows: HitWindows;
  private readonly missWindow: number;
  private readonly notes: NoteState[];
  private readonly queues: number[][];
  private readonly heads: number[];
  private judgments_: LiveJudgment[] = [];
  private counts: JudgmentCounts = emptyJudgmentCounts();
  private combo_ = 0;
  private maxCombo_ = 0;
  private heldMask_ = 0;
  private lastTickMs = Number.NEGATIVE_INFINITY;

  constructor(args: {
    notes: LiveNote[];
    columnCount: number;
    overallDifficulty: number;
    practiceRange?: PracticeRange | null;
  }) {
    const { columnCount, practiceRange } = args;
    this.columnCount = Math.max(1, columnCount);
    this.overallDifficulty = args.overallDifficulty;
    this.windows = maniaHitWindows(args.overallDifficulty);
    this.missWindow = this.windows.miss;

    const filtered = args.notes
      .map((n, index) => ({ n, index }))
      .filter(({ n }) => {
        if (!practiceRange) return true;
        return (
          n.startMs >= practiceRange.fromMs && n.startMs <= practiceRange.toMs
        );
      });

    // Keep original chart indices so judgments align when the notefield
    // still receives the full note list (or the same filtered list).
    this.notes = filtered.map(({ n, index }) => {
      const isHold = n.endMs > n.startMs + HOLD_EPS_MS;
      return {
        index,
        column: Math.min(
          this.columnCount - 1,
          Math.max(0, n.column),
        ),
        startMs: n.startMs,
        endMs: isHold ? n.endMs : n.startMs,
        isHold,
        headJudged: false,
        tailJudged: !isHold,
        holding: false,
      };
    });

    this.queues = Array.from({ length: this.columnCount }, () => []);
    for (let i = 0; i < this.notes.length; i += 1) {
      this.queues[this.notes[i]!.column]!.push(i);
    }
    this.heads = new Array(this.columnCount).fill(0);
  }

  get heldMask(): number {
    return this.heldMask_;
  }

  get judgments(): readonly LiveJudgment[] {
    return this.judgments_;
  }

  get combo(): number {
    return this.combo_;
  }

  get summary(): JudgmentSummary {
    return {
      accuracy: accuracyFromCounts(this.counts),
      combo: this.combo_,
      maxCombo: this.maxCombo_,
      counts: { ...this.counts },
    };
  }

  reset(): void {
    for (const note of this.notes) {
      note.headJudged = false;
      note.tailJudged = !note.isHold;
      note.holding = false;
    }
    this.heads.fill(0);
    this.judgments_ = [];
    this.counts = emptyJudgmentCounts();
    this.combo_ = 0;
    this.maxCombo_ = 0;
    this.heldMask_ = 0;
    this.lastTickMs = Number.NEGATIVE_INFINITY;
  }

  press(column: number, tMs: number): LiveJudgment | null {
    if (column < 0 || column >= this.columnCount) return null;
    this.tick(tMs);
    this.heldMask_ |= 1 << column;

    const note = this.nextUnjudgedHead(column, tMs);
    if (!note) return null;

    const error = tMs - note.startMs;
    const result = judgeError(Math.abs(error), this.windows);
    note.headJudged = true;
    if (note.isHold && result !== "miss") {
      note.holding = true;
    } else if (note.isHold && result === "miss") {
      note.tailJudged = true;
    }
    return this.pushJudgment({
      noteIndex: note.index,
      tMs,
      result,
      errorMs: error,
      isTail: false,
    });
  }

  release(column: number, tMs: number): LiveJudgment | null {
    if (column < 0 || column >= this.columnCount) return null;
    this.tick(tMs);
    this.heldMask_ &= ~(1 << column);

    const note = this.findHeldNote(column);
    if (!note) return null;

    note.holding = false;
    note.tailJudged = true;
    const error = tMs - note.endMs;
    let result = judgeError(Math.abs(error), this.windows);
    if (tMs < note.endMs - this.windows.meh) {
      result = result === "miss" ? "miss" : "meh";
    }
    return this.pushJudgment({
      noteIndex: note.index,
      tMs,
      result,
      errorMs: error,
      isTail: true,
    });
  }

  /** Auto-miss notes that have passed their windows. Call each animation frame. */
  tick(tMs: number): void {
    if (tMs < this.lastTickMs) {
      // Seek backward — leave state; caller should reset() on restart.
      this.lastTickMs = tMs;
      return;
    }
    this.lastTickMs = tMs;
    this.missExpiredNotes(tMs);
  }

  private pushJudgment(j: LiveJudgment): LiveJudgment {
    this.judgments_.push(j);
    this.counts[j.result] += 1;
    if (j.result === "miss") {
      this.combo_ = 0;
    } else {
      this.combo_ += 1;
      if (this.combo_ > this.maxCombo_) this.maxCombo_ = this.combo_;
    }
    return j;
  }

  private nextUnjudgedHead(col: number, tMs: number): NoteState | null {
    const q = this.queues[col]!;
    let h = this.heads[col]!;
    while (h < q.length) {
      const note = this.notes[q[h]!]!;
      if (note.headJudged) {
        h += 1;
        continue;
      }
      if (tMs < note.startMs - this.missWindow) {
        this.heads[col] = h;
        return null;
      }
      if (tMs > note.startMs + this.missWindow) {
        note.headJudged = true;
        if (note.isHold) {
          note.tailJudged = true;
        }
        this.pushJudgment({
          noteIndex: note.index,
          tMs: note.startMs + this.missWindow,
          result: "miss",
          errorMs: null,
          isTail: false,
        });
        h += 1;
        continue;
      }
      this.heads[col] = h;
      return note;
    }
    this.heads[col] = h;
    return null;
  }

  private findHeldNote(col: number): NoteState | null {
    const q = this.queues[col]!;
    for (let i = 0; i < q.length; i += 1) {
      const note = this.notes[q[i]!]!;
      if (note.holding && !note.tailJudged) return note;
    }
    return null;
  }

  private missExpiredNotes(tMs: number) {
    for (let col = 0; col < this.columnCount; col += 1) {
      this.nextUnjudgedHead(col, tMs);
      const q = this.queues[col]!;
      for (let i = 0; i < q.length; i += 1) {
        const note = this.notes[q[i]!]!;
        if (!note.isHold || note.tailJudged) continue;
        if (note.headJudged && tMs > note.endMs + this.missWindow) {
          note.tailJudged = true;
          note.holding = false;
          this.pushJudgment({
            noteIndex: note.index,
            tMs: note.endMs + this.missWindow,
            result: "miss",
            errorMs: null,
            isTail: true,
          });
        }
      }
    }
  }
}

/** Notes filtered for a practice window (same filter as LiveManiaPlay). */
export function filterNotesForPractice(
  notes: LiveNote[],
  practiceRange?: PracticeRange | null,
): LiveNote[] {
  if (!practiceRange) return notes;
  return notes.filter(
    (n) =>
      n.startMs >= practiceRange.fromMs && n.startMs <= practiceRange.toMs,
  );
}
