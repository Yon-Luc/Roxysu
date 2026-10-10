import type { Db } from "@roxysu/db/types";
import { RECOMMEND_FOCUS_SETTINGS_KEY } from "@roxysu/db/settings-keys";

/** Clear-rate band + difficulty targeting for a recommend focus. */
export type FocusBandConfig = {
  /** Inclusive lower accuracy bound (0–1). */
  accMin: number;
  /** Exclusive upper accuracy bound (0–1+eps). */
  accMax: number;
  /** Target Sunny relative to band skill (1.0 = same difficulty). */
  targetRatio: number;
  /** ± window around targetRatio. */
  tolerance: number;
};

export type DeficitFocusConfig = {
  targetRatio: number;
  tolerance: number;
};

export type RecommendFocusSettings = {
  push: FocusBandConfig;
  accuracy: FocusBandConfig;
  consistency: FocusBandConfig;
  deficit: DeficitFocusConfig;
  /** Top maps per accuracy band for skill estimate. */
  topPlays: number;
};

/**
 * Defaults match the product ask: Push uses a closed 90–95% clear band and
 * targets maps near that skill (±8%), not significantly above it.
 */
export const DEFAULT_FOCUS_SETTINGS: RecommendFocusSettings = {
  push: {
    accMin: 0.9,
    accMax: 0.95,
    targetRatio: 1.0,
    tolerance: 0.08,
  },
  accuracy: {
    accMin: 0.99,
    accMax: 1.01,
    targetRatio: 1.0,
    tolerance: 0.12,
  },
  consistency: {
    accMin: 0.96,
    accMax: 0.99,
    targetRatio: 1.0,
    tolerance: 0.12,
  },
  deficit: {
    targetRatio: 1.0,
    tolerance: 0.1,
  },
  topPlays: 30,
};

const ACC_MIN = 0.5;
const ACC_MAX_CEIL = 1.05;
const RATIO_MIN = 0.7;
const RATIO_MAX = 1.4;
const TOL_MIN = 0.02;
const TOL_MAX = 0.35;
const TOP_PLAYS_MIN = 1;
const TOP_PLAYS_MAX = 500;
const MIN_BAND_GAP = 0.005;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampAcc(n: number): number {
  return clamp(n, ACC_MIN, ACC_MAX_CEIL);
}

function clampRatio(n: number): number {
  return clamp(n, RATIO_MIN, RATIO_MAX);
}

function clampTol(n: number): number {
  return clamp(n, TOL_MIN, TOL_MAX);
}

function clampTopPlays(n: number): number {
  if (!Number.isFinite(n)) return 30;
  return Math.min(TOP_PLAYS_MAX, Math.max(TOP_PLAYS_MIN, Math.round(n)));
}

function normalizeBand(
  raw: Partial<FocusBandConfig> | null | undefined,
  fallback: FocusBandConfig,
): FocusBandConfig {
  let accMin =
    raw?.accMin != null && Number.isFinite(raw.accMin)
      ? clampAcc(raw.accMin)
      : fallback.accMin;
  let accMax =
    raw?.accMax != null && Number.isFinite(raw.accMax)
      ? clampAcc(raw.accMax)
      : fallback.accMax;
  if (accMax - accMin < MIN_BAND_GAP) {
    accMax = Math.min(ACC_MAX_CEIL, accMin + MIN_BAND_GAP);
    if (accMax - accMin < MIN_BAND_GAP) {
      accMin = Math.max(ACC_MIN, accMax - MIN_BAND_GAP);
    }
  }
  return {
    accMin,
    accMax,
    targetRatio:
      raw?.targetRatio != null && Number.isFinite(raw.targetRatio)
        ? clampRatio(raw.targetRatio)
        : fallback.targetRatio,
    tolerance:
      raw?.tolerance != null && Number.isFinite(raw.tolerance)
        ? clampTol(raw.tolerance)
        : fallback.tolerance,
  };
}

function normalizeDeficit(
  raw: Partial<DeficitFocusConfig> | null | undefined,
  fallback: DeficitFocusConfig,
): DeficitFocusConfig {
  return {
    targetRatio:
      raw?.targetRatio != null && Number.isFinite(raw.targetRatio)
        ? clampRatio(raw.targetRatio)
        : fallback.targetRatio,
    tolerance:
      raw?.tolerance != null && Number.isFinite(raw.tolerance)
        ? clampTol(raw.tolerance)
        : fallback.tolerance,
  };
}

/** Merge partial/invalid input with defaults. */
export function normalizeFocusSettings(
  raw: Partial<RecommendFocusSettings> | null | undefined,
): RecommendFocusSettings {
  return {
    push: normalizeBand(raw?.push, DEFAULT_FOCUS_SETTINGS.push),
    accuracy: normalizeBand(raw?.accuracy, DEFAULT_FOCUS_SETTINGS.accuracy),
    consistency: normalizeBand(
      raw?.consistency,
      DEFAULT_FOCUS_SETTINGS.consistency,
    ),
    deficit: normalizeDeficit(raw?.deficit, DEFAULT_FOCUS_SETTINGS.deficit),
    topPlays:
      raw?.topPlays != null ? clampTopPlays(raw.topPlays) : DEFAULT_FOCUS_SETTINGS.topPlays,
  };
}

export type FocusSettingsValidation =
  | { ok: true; settings: RecommendFocusSettings }
  | { ok: false; error: string };

function validateBand(
  label: string,
  band: FocusBandConfig | undefined,
): string | null {
  if (!band) return `${label} band is required`;
  if (
    !Number.isFinite(band.accMin) ||
    !Number.isFinite(band.accMax) ||
    !Number.isFinite(band.targetRatio) ||
    !Number.isFinite(band.tolerance)
  ) {
    return `${label} values must be finite numbers`;
  }
  if (band.accMin < ACC_MIN || band.accMax > ACC_MAX_CEIL) {
    return `${label} accuracy bounds must be in [${ACC_MIN}, ${ACC_MAX_CEIL}]`;
  }
  if (band.accMax - band.accMin < MIN_BAND_GAP) {
    return `${label} accuracy max must be greater than min`;
  }
  if (band.targetRatio < RATIO_MIN || band.targetRatio > RATIO_MAX) {
    return `${label} target difficulty must be in [${RATIO_MIN}, ${RATIO_MAX}]`;
  }
  if (band.tolerance < TOL_MIN || band.tolerance > TOL_MAX) {
    return `${label} tolerance must be in [${TOL_MIN}, ${TOL_MAX}]`;
  }
  return null;
}

/** Strict validation for settings PATCH. */
export function validateFocusSettingsInput(
  raw: Partial<RecommendFocusSettings> | null | undefined,
): FocusSettingsValidation {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "recommendFocus settings object is required" };
  }
  for (const label of ["push", "accuracy", "consistency"] as const) {
    const err = validateBand(label, raw[label]);
    if (err) return { ok: false, error: err };
  }
  if (!raw.deficit) {
    return { ok: false, error: "deficit settings are required" };
  }
  if (
    !Number.isFinite(raw.deficit.targetRatio) ||
    !Number.isFinite(raw.deficit.tolerance)
  ) {
    return { ok: false, error: "deficit values must be finite numbers" };
  }
  if (
    raw.deficit.targetRatio < RATIO_MIN ||
    raw.deficit.targetRatio > RATIO_MAX
  ) {
    return {
      ok: false,
      error: `deficit target difficulty must be in [${RATIO_MIN}, ${RATIO_MAX}]`,
    };
  }
  if (raw.deficit.tolerance < TOL_MIN || raw.deficit.tolerance > TOL_MAX) {
    return {
      ok: false,
      error: `deficit tolerance must be in [${TOL_MIN}, ${TOL_MAX}]`,
    };
  }
  if (raw.topPlays == null || !Number.isFinite(raw.topPlays)) {
    return { ok: false, error: "topPlays is required" };
  }
  if (raw.topPlays < TOP_PLAYS_MIN || raw.topPlays > TOP_PLAYS_MAX) {
    return {
      ok: false,
      error: `topPlays must be in [${TOP_PLAYS_MIN}, ${TOP_PLAYS_MAX}]`,
    };
  }
  return { ok: true, settings: normalizeFocusSettings(raw) };
}

function readSettingSync(db: Db, key: string): string | null {
  const row = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function parseFocusSettingsJson(
  raw: string | null | undefined,
): RecommendFocusSettings {
  if (raw == null || raw.trim() === "") {
    return { ...DEFAULT_FOCUS_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RecommendFocusSettings>;
    return normalizeFocusSettings(parsed);
  } catch {
    return { ...DEFAULT_FOCUS_SETTINGS };
  }
}

export function readFocusSettingsSync(db: Db): RecommendFocusSettings {
  return parseFocusSettingsJson(
    readSettingSync(db, RECOMMEND_FOCUS_SETTINGS_KEY),
  );
}

export async function readFocusSettings(
  db: Db,
): Promise<RecommendFocusSettings> {
  return readFocusSettingsSync(db);
}

export function serializeFocusSettings(settings: RecommendFocusSettings): string {
  const normalized = normalizeFocusSettings(settings);
  return JSON.stringify({
    push: {
      accMin: round4(normalized.push.accMin),
      accMax: round4(normalized.push.accMax),
      targetRatio: round4(normalized.push.targetRatio),
      tolerance: round4(normalized.push.tolerance),
    },
    accuracy: {
      accMin: round4(normalized.accuracy.accMin),
      accMax: round4(normalized.accuracy.accMax),
      targetRatio: round4(normalized.accuracy.targetRatio),
      tolerance: round4(normalized.accuracy.tolerance),
    },
    consistency: {
      accMin: round4(normalized.consistency.accMin),
      accMax: round4(normalized.consistency.accMax),
      targetRatio: round4(normalized.consistency.targetRatio),
      tolerance: round4(normalized.consistency.tolerance),
    },
    deficit: {
      targetRatio: round4(normalized.deficit.targetRatio),
      tolerance: round4(normalized.deficit.tolerance),
    },
    topPlays: normalized.topPlays,
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function bandCenter(band: FocusBandConfig): number {
  return (band.accMin + Math.min(band.accMax, 1)) / 2;
}

export function bandHalfWidth(band: FocusBandConfig): number {
  return Math.max((band.accMax - band.accMin) / 2, 0.01);
}

export function formatAccBandLabel(band: FocusBandConfig): string {
  const minPct = Math.round(band.accMin * 100);
  const maxPct = Math.round(Math.min(band.accMax, 1) * 100);
  if (band.accMax > 1) return `${minPct}%+`;
  return `${minPct}–${maxPct}%`;
}
