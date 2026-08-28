import type { JudgmentCounts } from "../integrations/mania-judge";

export type PlayResult = {
  chartId: string;
  title: string;
  artist: string;
  difficultyName: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: JudgmentCounts;
};

export function formatJudgmentCounts(counts: JudgmentCounts): string {
  return [
    `Perfect ${counts.perfect}`,
    `Great ${counts.great}`,
    `Good ${counts.good}`,
    `Ok ${counts.ok}`,
    `Meh ${counts.meh}`,
    `Miss ${counts.miss}`,
  ].join(" · ");
}
