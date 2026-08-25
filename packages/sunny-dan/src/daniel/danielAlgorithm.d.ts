export type DanielCalculateResult =
  | number
  | [number, number, number]
  | {
      star: number;
      lnRatio: number;
      columnCount: number;
      graph?: {
        times: number[];
        values: number[];
      };
    };

export declare function calculateDaniel(
  osuText: string,
  speedRate?: number,
  odFlag?: string | number | null,
  options?: { withGraph?: boolean; cvtFlag?: string | null },
): DanielCalculateResult;
