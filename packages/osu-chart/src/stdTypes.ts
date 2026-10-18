export type StdPoint = { x: number; y: number };

/** osu! hitSample colon field: normalSet:additionSet:index:volume:filename */
export type StdHitSample = {
  /** 0 = inherit timing; 1 normal, 2 soft, 3 drum */
  normalSet: number;
  additionSet: number;
  index: number;
  /** 0 = inherit timing volume */
  volume: number;
};

export type StdSampleTiming = {
  timeMs: number;
  /** 1 normal, 2 soft, 3 drum (osu timing-point sample set). */
  sampleSet: number;
  sampleIndex: number;
  /** 0–100 */
  volume: number;
};

export type StdHitObject =
  | {
      type: "circle";
      x: number;
      y: number;
      timeMs: number;
      /** Stack-adjusted position used for rendering / hit testing. */
      stackX: number;
      stackY: number;
      /** Type bit 2 — starts a new combo. Omitted → false. */
      newCombo?: boolean;
      /** Type bits 4–6 — combo colours to skip. Omitted → 0. */
      comboOffset?: number;
      /** HitSound bitfield (whistle/finish/clap). */
      hitSound?: number;
      hitSample?: StdHitSample;
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
      /** Type bit 2 — starts a new combo. Omitted → false. */
      newCombo?: boolean;
      /** Type bits 4–6 — combo colours to skip. Omitted → 0. */
      comboOffset?: number;
      hitSound?: number;
      hitSample?: StdHitSample;
      /** Per-edge hitSound bitfields (head, reverses…, tail), when present. */
      edgeHitSounds?: number[];
    }
  | {
      type: "spinner";
      timeMs: number;
      endMs: number;
      hitSound?: number;
      hitSample?: StdHitSample;
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
  /** Beatmap `[Colours]` Combo1…Combo8 as `#rrggbb`, when present. */
  comboColors: string[];
  timingPoints: Array<[timeMs: number, beatLengthMs: number]>;
  /** Sample-set / volume timeline (red + green lines). */
  sampleTiming: StdSampleTiming[];
  breaks: Array<[startMs: number, endMs: number]>;
  metaData: Record<string, string>;
};
