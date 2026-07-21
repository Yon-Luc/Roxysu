export type DanInterval = [number, number, string];

export type DanIndex = Record<
  number,
  {
    RC: { default: DanInterval[] };
    LN: { default: DanInterval[] };
  }
>;

export declare const DAN_INDEX: DanIndex;
