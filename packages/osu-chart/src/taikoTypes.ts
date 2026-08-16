export type TaikoColor = "don" | "kat";

export type TaikoHitObject =
  | {
      type: "hit";
      timeMs: number;
      color: TaikoColor;
      large: boolean;
    }
  | {
      type: "drumroll";
      timeMs: number;
      endMs: number;
      large: boolean;
      ticks: { tMs: number }[];
    }
  | {
      type: "swell";
      timeMs: number;
      endMs: number;
    };

export type ParsedTaikoChart = {
  gameMode: "1";
  status: "OK" | "Fail" | "NotTaiko";
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  sliderMultiplier: number;
  sliderTickRate: number;
  hitObjects: TaikoHitObject[];
  timingPoints: Array<[timeMs: number, beatLengthMs: number]>;
  breaks: Array<[startMs: number, endMs: number]>;
  metaData: Record<string, string>;
};
