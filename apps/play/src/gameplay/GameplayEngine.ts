import {
  accuracyFromCounts,
  emptyJudgmentCounts,
  judgeError,
  maniaHitWindows,
  RESULT_WEIGHT,
  type JudgmentCounts,
  type JudgmentResult,
} from "../integrations/mania-judge";
import { NoteType, type BeatmapChart } from "../beatmap/BeatmapChart";
import type { InputEvent } from "../input/InputManager";
import type { GameEventBus } from "../events/GameEventBus";

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

export type GameplaySnapshot = {
  songTimeMs: number;
  combo: number;
  maxCombo: number;
  score: number;
  accuracy: number;
  counts: JudgmentCounts;
  finished: boolean;
};

export class GameplayEngine {
  private notes: NoteState[] = [];
  private queues: number[][] = [];
  private heads: number[] = [];
  private readonly counts = emptyJudgmentCounts();
  private combo = 0;
  private maxCombo = 0;
  private score = 0;
  private columnCount = 7;
  private missWindow = 160;
  private overallDifficulty = 8;
  private finished = false;
  private lastNoteEndMs = 0;

  load(chart: BeatmapChart): void {
    this.columnCount = chart.columnCount;
    this.overallDifficulty = chart.overallDifficulty;
    const windows = maniaHitWindows(chart.overallDifficulty);
    this.missWindow = windows.miss;

    this.notes = [];
    this.queues = Array.from({ length: this.columnCount }, () => []);
    this.heads = new Array(this.columnCount).fill(0);
    this.counts.perfect = 0;
    this.counts.great = 0;
    this.counts.good = 0;
    this.counts.ok = 0;
    this.counts.meh = 0;
    this.counts.miss = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.finished = false;
    this.lastNoteEndMs = 0;

    for (let i = 0; i < chart.noteCount; i += 1) {
      const isHold = chart.type[i] === NoteType.Hold;
      const endMs = isHold ? chart.endMs[i]! : chart.startMs[i]!;
      const note: NoteState = {
        index: i,
        column: chart.column[i]!,
        startMs: chart.startMs[i]!,
        endMs,
        isHold,
        headJudged: false,
        tailJudged: !isHold,
        holding: false,
      };
      this.notes.push(note);
      this.queues[note.column]!.push(i);
      this.lastNoteEndMs = Math.max(this.lastNoteEndMs, endMs);
    }
  }

  update(timeMs: number, inputEvents: InputEvent[], events: GameEventBus): void {
    if (this.finished) return;

    this.missExpiredNotes(timeMs, events);

    for (const input of inputEvents) {
      if (input.type === "press") {
        this.onPress(input.lane, input.timeMs, events);
      } else {
        this.onRelease(input.lane, input.timeMs, events);
      }
    }

    if (timeMs > this.lastNoteEndMs + this.missWindow + 500) {
      this.flushRemainingMisses(timeMs, events);
      this.finished = true;
      events.emit({ type: "SongFinished", timeMs });
    }
  }

  getSnapshot(timeMs: number): GameplaySnapshot {
    return {
      songTimeMs: timeMs,
      combo: this.combo,
      maxCombo: this.maxCombo,
      score: this.score,
      accuracy: accuracyFromCounts(this.counts),
      counts: { ...this.counts },
      finished: this.finished,
    };
  }

  private onPress(lane: number, timeMs: number, events: GameEventBus): void {
    const note = this.nextUnjudgedHead(lane, timeMs, events);
    if (!note) return;

    const error = timeMs - note.startMs;
    const result = judgeError(Math.abs(error), maniaHitWindows(this.overallDifficulty));
    note.headJudged = true;
    if (note.isHold && result !== "miss") {
      note.holding = true;
    } else if (note.isHold) {
      note.tailJudged = true;
    }

    this.applyJudgment(note.index, note.column, result, timeMs, false, events);
  }

  private onRelease(lane: number, timeMs: number, events: GameEventBus): void {
    const note = this.findHeldNote(lane);
    if (!note) return;

    note.holding = false;
    note.tailJudged = true;
    const error = timeMs - note.endMs;
    let result = judgeError(Math.abs(error), maniaHitWindows(this.overallDifficulty));
    if (timeMs < note.endMs - maniaHitWindows(this.overallDifficulty).meh) {
      result = result === "miss" ? "miss" : "meh";
    }

    this.applyJudgment(note.index, note.column, result, timeMs, true, events);
  }

  private applyJudgment(
    noteIndex: number,
    lane: number,
    result: JudgmentResult,
    timeMs: number,
    isTail: boolean,
    events: GameEventBus,
  ): void {
    this.counts[result] += 1;
    if (result === "miss") {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += RESULT_WEIGHT[result];
    }

    events.emit({ type: "ComboChanged", combo: this.combo });
    if (isTail) {
      events.emit({
        type: "HoldCompleted",
        noteIndex,
        lane,
        result,
        timeMs,
      });
    } else if (result === "miss") {
      events.emit({ type: "NoteMiss", noteIndex, lane, timeMs });
    } else {
      events.emit({ type: "NoteHit", noteIndex, lane, result, timeMs });
    }
  }

  private nextUnjudgedHead(
    col: number,
    timeMs: number,
    events: GameEventBus,
  ): NoteState | null {
    const q = this.queues[col]!;
    let h = this.heads[col]!;

    while (h < q.length) {
      const note = this.notes[q[h]!]!;
      if (note.headJudged) {
        h += 1;
        continue;
      }
      if (timeMs < note.startMs - this.missWindow) {
        this.heads[col] = h;
        return null;
      }
      if (timeMs > note.startMs + this.missWindow) {
        note.headJudged = true;
        if (note.isHold) note.tailJudged = true;
        this.applyJudgment(note.index, note.column, "miss", timeMs, false, events);
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

  private missExpiredNotes(timeMs: number, events: GameEventBus): void {
    for (let col = 0; col < this.columnCount; col += 1) {
      this.nextUnjudgedHead(col, timeMs, events);
      const q = this.queues[col]!;
      for (let i = 0; i < q.length; i += 1) {
        const note = this.notes[q[i]!]!;
        if (!note.isHold || note.tailJudged) continue;
        if (note.headJudged && timeMs > note.endMs + this.missWindow) {
          note.tailJudged = true;
          note.holding = false;
          this.applyJudgment(note.index, note.column, "miss", timeMs, true, events);
        }
      }
    }
  }

  private flushRemainingMisses(timeMs: number, events: GameEventBus): void {
    for (const note of this.notes) {
      if (!note.headJudged) {
        note.headJudged = true;
        this.applyJudgment(note.index, note.column, "miss", timeMs, false, events);
      }
      if (note.isHold && !note.tailJudged) {
        note.tailJudged = true;
        this.applyJudgment(note.index, note.column, "miss", timeMs, true, events);
      }
    }
  }
}
