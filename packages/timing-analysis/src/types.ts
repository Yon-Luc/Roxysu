import type { ParsedOsuChart } from "@roxysu/osu-chart";

export type TimingIssueSeverity = "info" | "warn" | "error";

export type TimingIssueKind =
  | "off_snap"
  | "inconsistent_snap"
  | "bpm_change"
  | "high_density"
  | "ln_off_snap"
  | "overlap"
  | "missing_timing_points";

export type TimingIssue = {
  kind: TimingIssueKind;
  severity: TimingIssueSeverity;
  startMs: number;
  endMs?: number;
  message: string;
  meta?: Record<string, unknown>;
};

export type SnapDivisor = 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16;

export type TimingMetrics = {
  /** Representative BPM from the first uninherited timing point. */
  bpm: number;
  /** Best-fit snap divisor (4 = 1/4 note). */
  dominantSnap: SnapDivisor;
  /** Fraction of note starts aligned to dominant snap within tolerance. */
  snapCoverage: number;
  /** Fraction of note starts not on any common snap grid. */
  offSnapRatio: number;
  /** Peak rice notes starting within one beat. */
  peakNotesPerBeat: number;
  /** Uninherited timing point count. */
  timingPointCount: number;
};

export type TimingAnalysisResult = {
  algorithm: "timing-v1";
  metrics: TimingMetrics;
  issues: TimingIssue[];
};

export type TimingAnalysisOptions = {
  /** Max ms a note start can deviate from the snap grid. Default 3. */
  snapToleranceMs?: number;
  /** Notes per beat above this emit high_density. Default 24 for 7k-ish density. */
  densityWarnThreshold?: number;
  /** Minimum ms overlap on same column to flag. Default 1. */
  overlapEpsilonMs?: number;
};

export type { ParsedOsuChart };
