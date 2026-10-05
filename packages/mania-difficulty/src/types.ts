export type ManiaDifficultyOptions = {
  mods?: string[];
  clockRate?: number;
};

export type ManiaDifficultyNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type ManiaBeatmapInput = {
  columnCount: number;
  overallDifficulty: number;
  notes: ManiaDifficultyNote[];
};

export type ManiaDifficultyAttributes = {
  starRating: number;
  starRatingSs?: number;
  speedDifficulty?: number;
  technicalDifficulty?: number;
  jackDifficulty?: number;
  coordinationDifficulty?: number;
  releaseDifficulty?: number;
  variety?: number;
  lnRatio?: number;
  greatHitWindow?: number;
  meanManipulation?: number;
  noteCount?: number;
  holdNoteCount?: number;
  overallDifficulty?: number;
  scoreLossCoefficientA?: number;
  scoreLossCoefficientB?: number;
  scoreLossCoefficientC?: number;
  scoreLossCoefficientD?: number;
  upstreamSha?: string;
  generatorVersion?: string;
};
