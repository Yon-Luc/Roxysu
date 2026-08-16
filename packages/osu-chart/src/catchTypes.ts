export type CatchHitObject =
  | {
      type: "fruit";
      x: number;
      timeMs: number;
      hyperDash: boolean;
    }
  | {
      type: "droplet";
      x: number;
      timeMs: number;
      kind: "large" | "tiny";
    }
  | {
      type: "banana";
      x: number;
      timeMs: number;
    };

export type ParsedCatchChart = {
  gameMode: "2";
  status: "OK" | "Fail" | "NotCatch";
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  sliderMultiplier: number;
  sliderTickRate: number;
  hitObjects: CatchHitObject[];
  timingPoints: Array<[timeMs: number, beatLengthMs: number]>;
  breaks: Array<[startMs: number, endMs: number]>;
  metaData: Record<string, string>;
};

/** Catcher plate width in osu! pixels from CS. */
export function catcherWidth(cs: number): number {
  return 106.75 * Math.abs(1 - (0.7 * (cs - 5)) / 5);
}
