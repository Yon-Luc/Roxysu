import type { JudgmentResult } from "../integrations/mania-judge";

export type PlayfieldSkin = {
  id: string;
  name: string;
  laneColors: readonly string[];
  laneBackgroundEven: string;
  laneBackgroundOdd: string;
  playfieldBackground: string;
  belowReceptorBackground: string;
  receptorFill: string;
  receptorHeight: number;
  judgmentLineColor: string;
  noteBorderRadius: number;
  notePadding: number;
  judgmentColors: Partial<Record<JudgmentResult, string>>;
  judgmentMissColor: string;
};
