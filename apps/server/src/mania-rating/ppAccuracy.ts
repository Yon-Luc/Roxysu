/** Custom-accuracy % tiers for Rating Lab theoretical PP. */
export const PP_ACCURACY_TIERS = [100, 99.5, 97, 95, 93] as const;

export type PpAccuracyTier = (typeof PP_ACCURACY_TIERS)[number];

export const DEFAULT_PP_ACCURACY: PpAccuracyTier = 100;

/** Stable JSON / API key for a tier (e.g. 99.5 → "99.5", 100 → "100"). */
export function ppAccuracyKey(tier: number): string {
  if (Number.isInteger(tier)) return String(tier);
  return String(tier);
}

export const PP_ACCURACY_KEYS = PP_ACCURACY_TIERS.map(ppAccuracyKey);

export type PpByAccuracy = Record<string, number>;

export function parsePpByAccuracy(json: string | null | undefined): PpByAccuracy | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return null;
    const out: PpByAccuracy = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function hasCompletePpByAccuracy(
  map: PpByAccuracy | null | undefined,
): boolean {
  if (!map) return false;
  return PP_ACCURACY_KEYS.every((key) => {
    const v = map[key];
    return v != null && Number.isFinite(v);
  });
}

export function parsePpAccuracyParam(
  raw: string | number | undefined | null,
): PpAccuracyTier {
  if (raw == null || raw === "") return DEFAULT_PP_ACCURACY;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PP_ACCURACY;
  const match = PP_ACCURACY_TIERS.find((t) => Math.abs(t - n) < 1e-9);
  return match ?? DEFAULT_PP_ACCURACY;
}

/** PP at the selected custom-accuracy tier; falls back to SS for 100% when map incomplete. */
export function ppAtAccuracy(
  map: PpByAccuracy | null | undefined,
  tier: number,
  ppSs: number | null | undefined,
): number | null {
  const key = ppAccuracyKey(tier);
  const fromMap = map?.[key];
  if (fromMap != null && Number.isFinite(fromMap)) return fromMap;
  if (Math.abs(tier - 100) < 1e-9 && ppSs != null && Number.isFinite(ppSs)) {
    return ppSs;
  }
  return null;
}

type AccPpPoint = { acc: number; pp: number };

/** Sorted (accuracy %, PP) points from a curve, with SS fallback for 100%. */
export function accuracyCurvePoints(
  map: PpByAccuracy | null | undefined,
  ppSs?: number | null,
): AccPpPoint[] {
  const points: AccPpPoint[] = [];
  const seen = new Set<number>();

  if (map) {
    for (const [key, pp] of Object.entries(map)) {
      const acc = Number(key);
      if (!Number.isFinite(acc) || !Number.isFinite(pp)) continue;
      points.push({ acc, pp });
      seen.add(acc);
    }
  }

  if (
    ppSs != null &&
    Number.isFinite(ppSs) &&
    ![...seen].some((a) => Math.abs(a - 100) < 1e-9)
  ) {
    points.push({ acc: 100, pp: ppSs });
  }

  points.sort((a, b) => a.acc - b.acc);
  return points;
}

/**
 * Estimate PP for an arbitrary score accuracy (0–1 fraction or 0–100 percent)
 * by linearly interpolating the mania rating accuracy curve.
 *
 * Lazer rarely persists Score.PP locally; this approximates official NM PP from
 * the same custom-accuracy ladder used by Rating Lab / mania-rating-calc.
 */
export function interpolatePpFromAccuracy(
  map: PpByAccuracy | null | undefined,
  accuracy: number,
  ppSs?: number | null,
): number | null {
  if (!Number.isFinite(accuracy)) return null;
  // Scores store 0–1; callers may also pass percent.
  const accPct = accuracy <= 1 + 1e-9 ? accuracy * 100 : accuracy;
  const clamped = Math.max(0, Math.min(100, accPct));

  const points = accuracyCurvePoints(map, ppSs);
  if (points.length === 0) return null;

  if (clamped <= points[0]!.acc) {
    const first = points[0]!;
    if (first.acc <= 1e-9) return first.pp;
    // Below lowest tier: interpolate from 0pp @ 0% toward first point.
    return (clamped / first.acc) * first.pp;
  }

  const last = points[points.length - 1]!;
  if (clamped >= last.acc) return last.pp;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (clamped < a.acc || clamped > b.acc) continue;
    if (Math.abs(b.acc - a.acc) < 1e-12) return b.pp;
    const t = (clamped - a.acc) / (b.acc - a.acc);
    return a.pp + t * (b.pp - a.pp);
  }

  return null;
}

export function formatPpAccuracyLabel(tier: number): string {
  if (Math.abs(tier - 100) < 1e-9) return "SS (100%)";
  return `${ppAccuracyKey(tier)}%`;
}

/** SQLite expression: PP at accuracy tier, with pp_ss fallback for 100%. */
export function sqlPpAtAccuracy(
  tableAlias: string,
  accuracyKey: string,
): string {
  const path = `$.${accuracyKey}`;
  if (accuracyKey === "100") {
    return `COALESCE(json_extract(${tableAlias}.pp_by_accuracy_json, '${path}'), ${tableAlias}.pp_ss)`;
  }
  return `json_extract(${tableAlias}.pp_by_accuracy_json, '${path}')`;
}

/** True when cache row still needs a calculator run for accuracy-tier PP. */
export function sqlMissingPpByAccuracy(tableAlias = "mr"): string {
  // Any required tier missing ⇒ incomplete (all tiers written together).
  return `(
    ${tableAlias}.pp_by_accuracy_json IS NULL
    OR json_extract(${tableAlias}.pp_by_accuracy_json, '$.93') IS NULL
  )`;
}
