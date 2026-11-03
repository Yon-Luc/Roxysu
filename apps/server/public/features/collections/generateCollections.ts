import {
  reworkDanBaseTierNames,
  reworkDanQueryForTier,
  type DanTableKind,
} from "@roxysu/mania-difficulty";
import { COLLECTION_BATCH_MAX } from "@server/shared/collectionBatch";

export { COLLECTION_BATCH_MAX };

export const GENERATE_KEY_COUNTS = [4, 7] as const;
export const DEFAULT_STAR_MIN = 1;
export const DEFAULT_STAR_MAX = 10;
export const DEFAULT_STAR_STEP = 1;
export const DEFAULT_ACCURACY_BANDS = "90-93, 93-95, 95-97";

export type GenerateKeyCount = (typeof GENERATE_KEY_COUNTS)[number];

export type GeneratedCollection = {
  name: string;
  query: string;
};

export type GenerateBuild =
  | { ok: true; items: GeneratedCollection[] }
  | { ok: false; reason: "invalid" | "too-many" };

type RangeBand = {
  lo: number;
  hi: number;
  /** Last band includes hi. Earlier bands are [lo, hi). */
  inclusiveHi: boolean;
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Plain decimal, no trailing zeros. */
export function formatBound(n: number): string {
  const text = round6(n).toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

function collectionQuery(
  keyCount: number,
  body: string,
  extra: string | undefined,
): string {
  return [`key:${keyCount}`, body.trim(), extra?.trim() ?? ""]
    .filter((part) => part.length > 0)
    .join(" ");
}

function rangeQuery(field: "reworkstars" | "acc", band: RangeBand): string {
  const lo = formatBound(band.lo);
  const hi = formatBound(band.hi);
  const upper = band.inclusiveHi ? "<=" : "<";
  return `${field}:>=${lo} ${field}:${upper}${hi}`;
}

/**
 * Half-open buckets from min up to max. The last bucket includes max so the
 * endpoint is not dropped. Adjacent buckets do not share the boundary.
 */
export function starBands(
  min: number,
  max: number,
  step: number,
): RangeBand[] | "invalid" | "too-many" {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) {
    return "invalid";
  }
  if (!(step > 0) || !(min < max)) return "invalid";

  const end = round6(max);
  const width = round6(step);
  if (!(width > 0)) return "invalid";

  const bands: RangeBand[] = [];
  let lo = round6(min);
  while (lo < end) {
    if (bands.length >= COLLECTION_BATCH_MAX) return "too-many";
    let hi = round6(lo + width);
    if (!(hi > lo)) return "invalid";
    const last = hi >= end;
    if (last) hi = end;
    bands.push({ lo, hi, inclusiveHi: last });
    lo = hi;
  }
  return bands.length > 0 ? bands : "invalid";
}

/** `90-93, 93-95, 95-97`. The last band includes its upper bound. */
export function parseAccuracyBands(
  text: string,
): RangeBand[] | "invalid" | "too-many" {
  const parts = text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "invalid";
  if (parts.length > COLLECTION_BATCH_MAX) return "too-many";

  const raw: { lo: number; hi: number }[] = [];
  for (const part of parts) {
    const match = part.match(
      /^(-?\d+(?:\.\d+)?)\s*(?:-|\.\.)\s*(-?\d+(?:\.\d+)?)$/,
    );
    if (!match) return "invalid";
    const lo = Number(match[1]);
    const hi = Number(match[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
      return "invalid";
    }
    if (lo < 0 || hi > 100) return "invalid";
    raw.push({ lo, hi });
  }
  return raw.map((band, index) => ({
    ...band,
    inclusiveHi: index === raw.length - 1,
  }));
}

export function buildStarCollections(opts: {
  keyCount: number;
  min: number;
  max: number;
  step: number;
  extra?: string;
}): GenerateBuild {
  const bands = starBands(opts.min, opts.max, opts.step);
  if (bands === "invalid" || bands === "too-many") return { ok: false, reason: bands };
  return {
    ok: true,
    items: bands.map((band) => ({
      name: `${opts.keyCount}K rework ${formatBound(band.lo)}-${formatBound(band.hi)}`,
      query: collectionQuery(opts.keyCount, rangeQuery("reworkstars", band), opts.extra),
    })),
  };
}

export function buildAccuracyCollections(opts: {
  keyCount: number;
  bands: string;
  extra?: string;
}): GenerateBuild {
  const bands = parseAccuracyBands(opts.bands);
  if (bands === "invalid" || bands === "too-many") return { ok: false, reason: bands };
  return {
    ok: true,
    items: bands.map((band) => ({
      name: `${opts.keyCount}K acc ${formatBound(band.lo)}-${formatBound(band.hi)}`,
      query: collectionQuery(opts.keyCount, rangeQuery("acc", band), opts.extra),
    })),
  };
}

export function buildDanCollections(opts: {
  keyCount: number;
  tiers: readonly string[];
  extra?: string;
}): GenerateBuild {
  if (opts.tiers.length > COLLECTION_BATCH_MAX) {
    return { ok: false, reason: "too-many" };
  }
  return {
    ok: true,
    items: opts.tiers.map((tier) => ({
      name: `${opts.keyCount}K ${tier}`,
      query: collectionQuery(
        opts.keyCount,
        reworkDanQueryForTier(tier),
        opts.extra,
      ),
    })),
  };
}

/** True when the LN table is its own list, not a rice fallback. */
export function hasDistinctLnTable(keyCount: number): boolean {
  const rice = reworkDanBaseTierNames(keyCount, "rice");
  const ln = reworkDanBaseTierNames(keyCount, "ln");
  if (ln.length === 0 || ln.length !== rice.length) return ln.length > 0;
  return ln.some((name, index) => name !== rice[index]);
}

export function danTiersFor(
  keyCount: number,
  kind: DanTableKind,
): string[] {
  return reworkDanBaseTierNames(keyCount, kind);
}
