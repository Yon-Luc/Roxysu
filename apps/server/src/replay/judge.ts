import type { ReplayFrame } from "./decode";
import {
  adjustOverallDifficulty,
  type ModAcronyms,
} from "./mods";

export type ReplayNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type JudgmentResult =
  | "perfect"
  | "great"
  | "good"
  | "ok"
  | "meh"
  | "miss";

export type ReplayJudgment = {
  noteIndex: number;
  /** When the judgment fires on the map clock. */
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  /** true when this is a hold-note tail judgment. */
  isTail: boolean;
};

export type JudgmentSummary = {
  accuracy: number;
  maxCombo: number;
  counts: Record<JudgmentResult, number>;
};

/** Mania accuracy weights — Perfect uses 305 (stable/lazer display). */
const RESULT_WEIGHT: Record<JudgmentResult, number> = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
};

const ACC_SCALE = 305;

type HitWindows = {
  perfect: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
};

/** Standard (non-convert) mania hit windows from OD. Values are half-widths in ms. */
export function maniaHitWindows(od: number): HitWindows {
  const trunc = (n: number) => Math.trunc(n);
  return {
    perfect: 16,
    great: trunc(64 - 3 * od),
    good: trunc(97 - 3 * od),
    ok: trunc(127 - 3 * od),
    meh: trunc(151 - 3 * od),
    miss: trunc(178 - 3 * od),
  };
}

function judgeError(absError: number, windows: HitWindows): JudgmentResult {
  const err = Math.round(absError);
  if (err <= windows.perfect) return "perfect";
  if (err <= windows.great) return "great";
  if (err <= windows.good) return "good";
  if (err <= windows.ok) return "ok";
  if (err <= windows.meh) return "meh";
  return "miss";
}

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

/**
 * Approximate mania judgments from legacy key frames + chart notes.
 * Close enough for rewatch visuals / live HUD; not a full lazer ruleset sim.
 */
export function simulateManiaJudgments(args: {
  notes: ReplayNote[];
  frames: ReplayFrame[];
  columnCount: number;
  overallDifficulty: number;
  mods: ModAcronyms;
}): { judgments: ReplayJudgment[]; summary: JudgmentSummary } {
  const { frames, columnCount, mods } = args;
  const od = adjustOverallDifficulty(args.overallDifficulty, mods);
  const windows = maniaHitWindows(od);
  const missWindow = windows.miss;

  const notes: NoteState[] = args.notes.map((n, index) => {
    const column = mods.mirror
      ? columnCount - 1 - n.column
      : n.column;
    const isHold = n.endMs > n.startMs + 20;
    return {
      index,
      column: Math.min(columnCount - 1, Math.max(0, column)),
      startMs: n.startMs,
      endMs: isHold ? n.endMs : n.startMs,
      isHold,
      headJudged: false,
      tailJudged: !isHold,
      holding: false,
    };
  });

  // Per-column queues of note indices sorted by start.
  const queues: number[][] = Array.from({ length: columnCount }, () => []);
  for (let i = 0; i < notes.length; i += 1) {
    queues[notes[i]!.column]!.push(i);
  }
  const heads = new Array(columnCount).fill(0);

  const judgments: ReplayJudgment[] = [];
  let combo = 0;
  let maxCombo = 0;

  const counts: Record<JudgmentResult, number> = {
    perfect: 0,
    great: 0,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 0,
  };

  function pushJudgment(j: ReplayJudgment) {
    judgments.push(j);
    counts[j.result] += 1;
    if (j.result === "miss") {
      combo = 0;
    } else {
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
    }
  }

  function nextUnjudgedHead(col: number, tMs: number): NoteState | null {
    const q = queues[col]!;
    let h = heads[col]!;
    while (h < q.length) {
      const note = notes[q[h]!]!;
      if (note.headJudged) {
        h += 1;
        continue;
      }
      // Too early for this note's window.
      if (tMs < note.startMs - missWindow) return null;
      // Past miss window → auto-miss and advance.
      if (tMs > note.startMs + missWindow) {
        note.headJudged = true;
        if (note.isHold) {
          note.tailJudged = true;
        }
        pushJudgment({
          noteIndex: note.index,
          tMs: note.startMs + missWindow,
          result: "miss",
          errorMs: null,
          isTail: false,
        });
        h += 1;
        continue;
      }
      heads[col] = h;
      return note;
    }
    heads[col] = h;
    return null;
  }

  function findHeldNote(col: number): NoteState | null {
    const q = queues[col]!;
    for (let i = 0; i < q.length; i += 1) {
      const note = notes[q[i]!]!;
      if (note.holding && !note.tailJudged) return note;
    }
    return null;
  }

  function missExpiredNotes(tMs: number) {
    for (let col = 0; col < columnCount; col += 1) {
      nextUnjudgedHead(col, tMs);
      // Tail misses: held note released too late / never released.
      const q = queues[col]!;
      for (let i = 0; i < q.length; i += 1) {
        const note = notes[q[i]!]!;
        if (!note.isHold || note.tailJudged) continue;
        if (note.headJudged && tMs > note.endMs + missWindow) {
          note.tailJudged = true;
          note.holding = false;
          pushJudgment({
            noteIndex: note.index,
            tMs: note.endMs + missWindow,
            result: "miss",
            errorMs: null,
            isTail: true,
          });
        }
      }
    }
  }

  let prevKeys = 0;
  // Ensure we process time 0 even with empty frames.
  const timeline =
    frames.length > 0
      ? frames
      : [{ tMs: 0, keys: 0 }];

  for (const frame of timeline) {
    missExpiredNotes(frame.tMs);
    const keys = frame.keys;
    const pressed = keys & ~prevKeys;
    const released = prevKeys & ~keys;

    for (let col = 0; col < columnCount; col += 1) {
      const bit = 1 << col;
      if (pressed & bit) {
        const note = nextUnjudgedHead(col, frame.tMs);
        if (note) {
          const error = frame.tMs - note.startMs;
          const result = judgeError(Math.abs(error), windows);
          note.headJudged = true;
          if (note.isHold && result !== "miss") {
            note.holding = true;
          } else if (note.isHold && result === "miss") {
            note.tailJudged = true;
          }
          pushJudgment({
            noteIndex: note.index,
            tMs: frame.tMs,
            result,
            errorMs: error,
            isTail: false,
          });
        }
      }
      if (released & bit) {
        const note = findHeldNote(col);
        if (note) {
          note.holding = false;
          note.tailJudged = true;
          const error = frame.tMs - note.endMs;
          let result = judgeError(Math.abs(error), windows);
          // Very early release → at best meh (simplified).
          if (frame.tMs < note.endMs - windows.meh) {
            result = result === "miss" ? "miss" : "meh";
          }
          pushJudgment({
            noteIndex: note.index,
            tMs: frame.tMs,
            result,
            errorMs: error,
            isTail: true,
          });
        }
      }
    }

    prevKeys = keys;
  }

  // Flush remaining notes as misses at end of timeline.
  const endT =
    timeline.length > 0 ? timeline[timeline.length - 1]!.tMs + missWindow + 1 : 0;
  missExpiredNotes(endT);
  for (const note of notes) {
    if (!note.headJudged) {
      note.headJudged = true;
      pushJudgment({
        noteIndex: note.index,
        tMs: note.startMs + missWindow,
        result: "miss",
        errorMs: null,
        isTail: false,
      });
    }
    if (note.isHold && !note.tailJudged) {
      note.tailJudged = true;
      pushJudgment({
        noteIndex: note.index,
        tMs: note.endMs + missWindow,
        result: "miss",
        errorMs: null,
        isTail: true,
      });
    }
  }

  judgments.sort((a, b) => a.tMs - b.tMs || a.noteIndex - b.noteIndex);

  const totalWeight =
    counts.perfect * RESULT_WEIGHT.perfect +
    counts.great * RESULT_WEIGHT.great +
    counts.good * RESULT_WEIGHT.good +
    counts.ok * RESULT_WEIGHT.ok +
    counts.meh * RESULT_WEIGHT.meh;
  const judged =
    counts.perfect +
    counts.great +
    counts.good +
    counts.ok +
    counts.meh +
    counts.miss;
  // Empty chart → 100%; else Σ(weight) / (305 × notes judged).
  const accuracy = judged > 0 ? totalWeight / (judged * ACC_SCALE) : 1;

  return {
    judgments,
    summary: { accuracy, maxCombo, counts },
  };
}
