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
