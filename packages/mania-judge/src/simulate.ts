import {
  accuracyFromCounts,
  emptyJudgmentCounts,
  judgeError,
  maniaHitWindows,
  type JudgmentResult,
  type JudgmentSummary,
} from "./windows";
import {
  adjustOverallDifficulty,
  scaleManiaHitWindows,
  type ModAcronyms,
} from "./mods";

export type ReplayFrame = {
  /** Map-clock time in milliseconds. */
  tMs: number;
  /** Mania key bitmask (bit i = column i pressed). */
  keys: number;
};

export type ReplayNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type ReplayJudgment = {
  noteIndex: number;
  /** When the judgment fires on the map clock. */
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  /** true when this is a hold-note tail judgment. */
  isTail: boolean;
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
  const windows = scaleManiaHitWindows(maniaHitWindows(od), mods.rate);
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

  const counts = emptyJudgmentCounts();

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

  return {
    judgments,
    summary: {
      accuracy: accuracyFromCounts(counts),
      combo,
      maxCombo,
      counts,
    },
  };
}
