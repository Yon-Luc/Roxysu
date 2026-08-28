import type { JudgmentResult } from "../integrations/mania-judge";

export type PlayfieldSkinSprites = {
  notes: readonly (string | null)[];
  keysUp: readonly (string | null)[];
  keysDown: readonly (string | null)[];
  stageLeft: string | null;
  stageRight: string | null;
};

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
  /** Absolute image paths resolved from the skin folder; null uses procedural colors. */
  sprites: PlayfieldSkinSprites | null;
  /** Folder or `.osk` path the skin was loaded from. */
  sourcePath: string | null;
};
