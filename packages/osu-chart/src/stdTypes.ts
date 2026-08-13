export type StdPoint = { x: number; y: number };

export type StdHitObject =
  | {
      type: "circle";
      x: number;
      y: number;
      timeMs: number;
      /** Stack-adjusted position used for rendering / hit testing. */
      stackX: number;
      stackY: number;
    }
  | {
      type: "slider";
      x: number;
      y: number;
      timeMs: number;
      endMs: number;
      /** Sampled path in osu! coords (includes start; length ≈ pixelLength). */
      path: StdPoint[];
      repeats: number;
      pixelLength: number;
      stackX: number;
      stackY: number;
      /**
       * Slider ticks. `frac` is the position along the path (0 = head, 1 =
       * tail) — identical across spans; `tMs` is the absolute tick time.
       * Timing-accurate (beatLength / SliderTickRate spacing, per timing point).
       */
      ticks: { frac: number; tMs: number }[];
    }
  | {
      type: "spinner";
      timeMs: number;
      endMs: number;
    };

export type ParsedStdChart = {
  gameMode: "0";
  status: "OK" | "Fail" | "NotStd";
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  stackLeniency: number;
  sliderMultiplier: number;
  sliderTickRate: number;
  hitObjects: StdHitObject[];
  timingPoints: Array<[timeMs: number, beatLengthMs: number]>;
  breaks: Array<[startMs: number, endMs: number]>;
  metaData: Record<string, string>;
};
