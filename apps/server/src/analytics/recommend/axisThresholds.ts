import type { Db } from "@roxysu/db/types";
import {
  RECOMMEND_FLN_RATIO_THRESHOLD_KEY,
  RECOMMEND_LN_RATIO_THRESHOLD_KEY,
} from "@roxysu/db/settings-keys";
import {
  FLN_RATIO_THRESHOLD,
  LN_DAN_RATIO_THRESHOLD,
} from "../../map-analysis/estDiff";

/** Rice / LN / FLN classification boundaries (ln_ratio 0–1). */
export type AxisThresholds = {
  /** Rice → LN boundary (maps with ratio ≥ this are LN or FLN). */
  ln: number;
  /** LN → FLN boundary (maps with ratio ≥ this are FLN). */
  fln: number;
};

export const DEFAULT_AXIS_THRESHOLDS: AxisThresholds = {
  ln: LN_DAN_RATIO_THRESHOLD,
  fln: FLN_RATIO_THRESHOLD,
};

const MIN_THRESHOLD = 0.01;
const MAX_THRESHOLD = 1;
const MIN_GAP = 0.01;

function parseRatio(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Clamp a single boundary into the allowed range. */
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AXIS_THRESHOLDS.ln;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value));
}

/**
 * Normalize a candidate pair. Ensures ln < fln with at least MIN_GAP.
 * Invalid / missing values fall back to defaults.
 */
export function normalizeAxisThresholds(
  lnRaw: number | null | undefined,
  flnRaw: number | null | undefined,
): AxisThresholds {
  let ln =
    lnRaw != null && Number.isFinite(lnRaw)
      ? clampThreshold(lnRaw)
      : DEFAULT_AXIS_THRESHOLDS.ln;
  let fln =
    flnRaw != null && Number.isFinite(flnRaw)
      ? clampThreshold(flnRaw)
      : DEFAULT_AXIS_THRESHOLDS.fln;

  if (ln >= fln) {
    // Prefer keeping FLN when both provided but inverted; else defaults.
    if (flnRaw != null && Number.isFinite(flnRaw) && lnRaw == null) {
      ln = Math.max(MIN_THRESHOLD, fln - MIN_GAP);
    } else if (lnRaw != null && Number.isFinite(lnRaw) && flnRaw == null) {
      fln = Math.min(MAX_THRESHOLD, ln + MIN_GAP);
    } else {
      return { ...DEFAULT_AXIS_THRESHOLDS };
    }
  }

  if (fln - ln < MIN_GAP) {
    fln = Math.min(MAX_THRESHOLD, ln + MIN_GAP);
    if (fln - ln < MIN_GAP) {
      ln = Math.max(MIN_THRESHOLD, fln - MIN_GAP);
    }
  }

  return { ln, fln };
}

export type AxisThresholdsValidation =
  | { ok: true; thresholds: AxisThresholds }
  | { ok: false; error: string };

/** Strict validation for settings PATCH (rejects inverted / out-of-range). */
export function validateAxisThresholdsInput(
  lnRaw: number | null | undefined,
  flnRaw: number | null | undefined,
): AxisThresholdsValidation {
  if (lnRaw == null || flnRaw == null) {
    return { ok: false, error: "Both lnRatioThreshold and flnRatioThreshold are required" };
  }
  if (!Number.isFinite(lnRaw) || !Number.isFinite(flnRaw)) {
    return { ok: false, error: "Thresholds must be finite numbers" };
  }
  if (lnRaw <= 0 || lnRaw > 1 || flnRaw <= 0 || flnRaw > 1) {
    return {
      ok: false,
      error: "Thresholds must be in (0, 1]",
    };
  }
  if (lnRaw >= flnRaw) {
    return {
      ok: false,
      error: "LN threshold must be strictly less than FLN threshold",
    };
  }
  return {
    ok: true,
    thresholds: { ln: clampThreshold(lnRaw), fln: clampThreshold(flnRaw) },
  };
}

function readSettingSync(db: Db, key: string): string | null {
  const row = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

/** Sync read for recommend / skill / query paths. */
export function readAxisThresholdsSync(db: Db): AxisThresholds {
  const ln = parseRatio(readSettingSync(db, RECOMMEND_LN_RATIO_THRESHOLD_KEY));
  const fln = parseRatio(readSettingSync(db, RECOMMEND_FLN_RATIO_THRESHOLD_KEY));
  return normalizeAxisThresholds(ln, fln);
}

/** Async read for settings response. */
export async function readAxisThresholds(db: Db): Promise<AxisThresholds> {
  return readAxisThresholdsSync(db);
}

export function axisThresholdsToPercents(t: AxisThresholds): {
  lnPct: number;
  flnPct: number;
} {
  return {
    lnPct: Math.round(t.ln * 1000) / 10,
    flnPct: Math.round(t.fln * 1000) / 10,
  };
}

export function serializeAxisThreshold(value: number): string {
  // Avoid binary float noise in KV (0.2 → "0.2").
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}
