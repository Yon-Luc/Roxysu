import type { Db } from "@roxysu/db/types";
import { beatmaps } from "@roxysu/db/schema";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { parseOsuChart } from "@roxysu/osu-chart";
import {
  analyzeChartTiming,
  type TimingIssue,
  type TimingIssueKind,
} from "@roxysu/timing-analysis";
import { getOsuDataPath, resolveLazerFilePath } from "../shared/lazer-files";

const MAX_ISSUES = 40;

export type ChartTimingRating = {
  algorithm: string;
  metrics: {
    bpm: number;
    dominantSnap: number;
    snapCoverage: number;
    offSnapRatio: number;
    peakNotesPerBeat: number;
    timingPointCount: number;
  };
  issues: TimingIssue[];
  issueCounts: Partial<Record<TimingIssueKind, number>>;
  error: string | null;
};

function countIssues(issues: TimingIssue[]): Partial<Record<TimingIssueKind, number>> {
  const counts: Partial<Record<TimingIssueKind, number>> = {};
  for (const issue of issues) {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  }
  return counts;
}

function prioritizeIssues(issues: TimingIssue[]): TimingIssue[] {
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return [...issues]
    .sort((a, b) => {
      const sev = rank[a.severity] - rank[b.severity];
      return sev !== 0 ? sev : a.startMs - b.startMs;
    })
    .slice(0, MAX_ISSUES);
}

export async function loadBeatmapOsu(
  db: Db,
  beatmapId: string,
): Promise<
  | { ok: true; osuText: string; beatmap: typeof beatmaps.$inferSelect }
  | { ok: false; error: string }
> {
  const [beatmap] = await db
    .select()
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return { ok: false, error: "Beatmap not found" };
  if (beatmap.rulesetShortName !== "mania") {
    return { ok: false, error: "Timing analysis is mania-only" };
  }
  if (!beatmap.hash) return { ok: false, error: "Beatmap hash missing" };

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) return { ok: false, error: "Could not resolve lazer file path" };

  try {
    const osuText = readFileSync(filePath, "utf8");
    return { ok: true, osuText, beatmap };
  } catch {
    return { ok: false, error: "Beatmap file not found in lazer files store" };
  }
}

export function chartTimingFromOsuText(osuText: string): ChartTimingRating {
  const chart = parseOsuChart(osuText);
  const result = analyzeChartTiming(chart);
  return {
    algorithm: result.algorithm,
    metrics: result.metrics,
    issues: prioritizeIssues(result.issues),
    issueCounts: countIssues(result.issues),
    error: null,
  };
}

/** Analyze snap/BPM consistency from the on-disk `.osu` file. */
export async function getChartTimingAnalysis(
  db: Db,
  beatmapId: string,
): Promise<ChartTimingRating | null> {
  const loaded = await loadBeatmapOsu(db, beatmapId);
  if (!loaded.ok) {
    return {
      algorithm: "timing-v1",
      metrics: {
        bpm: 0,
        dominantSnap: 4,
        snapCoverage: 0,
        offSnapRatio: 0,
        peakNotesPerBeat: 0,
        timingPointCount: 0,
      },
      issues: [],
      issueCounts: {},
      error: loaded.error,
    };
  }

  try {
    return chartTimingFromOsuText(loaded.osuText);
  } catch (err) {
    return {
      algorithm: "timing-v1",
      metrics: {
        bpm: 0,
        dominantSnap: 4,
        snapCoverage: 0,
        offSnapRatio: 0,
        peakNotesPerBeat: 0,
        timingPointCount: 0,
      },
      issues: [],
      issueCounts: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
