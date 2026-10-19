import { catcherWidth, type CatchHitObject } from "@roxysu/osu-chart";
import {
  emptyJudgmentCounts,
  type JudgmentResult,
  type JudgmentSummary,
} from "@roxysu/mania-judge";
import type { ModAcronyms } from "@roxysu/mania-judge/mods";
import { accuracyFromSlices } from "./accuracy";
import type { CatchReplayFrame } from "./decode";

export type CatchReplayJudgment = {
  noteIndex: number;
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  isTail: boolean;
  kind: "fruit" | "droplet" | "banana";
  /** Points this judgment adds toward accuracy. Caught objects that count are 1. */
  accuracyPoints: number;
  /** Max points. 0 excludes bananas. */
  accuracyMax: number;
};

const OSU_WIDTH = 512;

/** Fruits and droplets count equally. Bananas are bonus and are excluded. */
export function catchAccuracySlice(
  kind: CatchReplayJudgment["kind"],
  result: JudgmentResult,
): { accuracyPoints: number; accuracyMax: number } {
  if (kind === "banana") return { accuracyPoints: 0, accuracyMax: 0 };
  const caught = result !== "miss";
  return { accuracyPoints: caught ? 1 : 0, accuracyMax: 1 };
}

export function adjustCatchDifficulty(
  args: { cs: number; ar: number; od: number },
  mods: ModAcronyms,
): { cs: number; ar: number; od: number } {
  let cs = args.cs;
  let ar = args.ar;
  let od = args.od;
  if (mods.hardRock) {
    cs = Math.min(10, cs * 1.3);
    ar = Math.min(10, ar * 1.4);
    od = Math.min(10, od * 1.4);
  }
  if (mods.easy) {
    cs *= 0.5;
    ar *= 0.5;
    od *= 0.5;
  }
  return { cs, ar, od };
}

export function applyCatchHardRockFlip(
  hitObjects: CatchHitObject[],
  frames: CatchReplayFrame[],
  hardRock: boolean,
): { hitObjects: CatchHitObject[]; frames: CatchReplayFrame[] } {
  if (!hardRock) return { hitObjects, frames };
  const flipX = (x: number) => OSU_WIDTH - x;
  return {
    hitObjects: hitObjects.map((obj) => ({ ...obj, x: flipX(obj.x) })),
    frames: frames.map((f) => ({ ...f, x: flipX(f.x) })),
  };
}

function catcherAt(
  frames: CatchReplayFrame[],
  tMs: number,
): { x: number; dashing: boolean } | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= tMs) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return frames[0]!;
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) return a;
  const u = (tMs - a.tMs) / (b.tMs - a.tMs);
  return {
    x: a.x + (b.x - a.x) * u,
    dashing: a.dashing,
  };
}

export function simulateCatchJudgments(args: {
  hitObjects: CatchHitObject[];
  frames: CatchReplayFrame[];
  circleSize: number;
  mods: ModAcronyms;
}): { judgments: CatchReplayJudgment[]; summary: JudgmentSummary } {
  const diff = adjustCatchDifficulty(
    { cs: args.circleSize, ar: 5, od: 5 },
    args.mods,
  );
  const halfWidth = catcherWidth(diff.cs) / 2;
  const judgments: CatchReplayJudgment[] = [];
  const counts = emptyJudgmentCounts();
  let combo = 0;
  let maxCombo = 0;

  function push(
    j: Omit<CatchReplayJudgment, "accuracyPoints" | "accuracyMax">,
    breaksCombo: boolean,
  ) {
    const full: CatchReplayJudgment = {
      ...j,
      ...catchAccuracySlice(j.kind, j.result),
    };
    judgments.push(full);
    counts[full.result] += 1;
    if (full.result === "miss") {
      if (breaksCombo) combo = 0;
    } else {
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
    }
  }

  for (let i = 0; i < args.hitObjects.length; i += 1) {
    const obj = args.hitObjects[i]!;
    const plate = catcherAt(args.frames, obj.timeMs);
    const caught =
      plate != null && Math.abs(plate.x - obj.x) <= halfWidth * 1.02;

    if (obj.type === "fruit") {
      push(
        {
          noteIndex: i,
          tMs: obj.timeMs,
          result: caught ? "great" : "miss",
          errorMs: plate != null ? plate.x - obj.x : null,
          isTail: false,
          kind: "fruit",
        },
        true,
      );
      continue;
    }

    if (obj.type === "droplet") {
      const result: JudgmentResult = caught
        ? obj.kind === "large"
          ? "good"
          : "ok"
        : "miss";
      push(
        {
          noteIndex: i,
          tMs: obj.timeMs,
          result,
          errorMs: plate != null ? plate.x - obj.x : null,
          isTail: false,
          kind: "droplet",
        },
        obj.kind === "large",
      );
      continue;
    }

    push(
      {
        noteIndex: i,
        tMs: obj.timeMs,
        result: caught ? "meh" : "miss",
        errorMs: plate != null ? plate.x - obj.x : null,
        isTail: false,
        kind: "banana",
      },
      false,
    );
  }

  return {
    judgments,
    summary: {
      accuracy: accuracyFromSlices(judgments),
      combo,
      maxCombo,
      counts,
    },
  };
}
