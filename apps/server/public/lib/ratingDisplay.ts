import { useSyncExternalStore } from "react";
import { estDiff } from "@roxysu/sunny-dan";
import { reworkDanLabel } from "@roxysu/mania-difficulty/dans";
import { formatStars } from "./format";

export type RatingDisplayMode = "osu" | "dan" | "sunny" | "rework";

/** Skill axes for mapping Sunny ★ → the matching dan table. */
export type SkillRatingAxis = "overall" | "rc" | "ln" | "fln";

const STORAGE_KEY = "roxysu:rating-display";

/** 7K only — skill estimates are Sunny 7K. */
const SKILL_KEY_COUNT = 7;

/** Representative LN ratios so estDiff picks RC vs LN dan tables. */
const AXIS_LN_RATIO: Record<SkillRatingAxis, number> = {
  overall: 0,
  rc: 0,
  ln: 0.5,
  fln: 0.9,
};

const OPTIONS: Array<{
  id: RatingDisplayMode;
  label: string;
  description: string;
}> = [
  {
    id: "osu",
    label: "osu! star rating",
    description: "Default difficulty stars from osu!/lazer.",
  },
  {
    id: "dan",
    label: "Daniel dan (4K) / Sunny dan",
    description: "Daniel dan on 4K when available; Sunny dan on other key counts.",
  },
  {
    id: "sunny",
    label: "Sunny star rating",
    description: "Daniel stars on 4K when available; Sunny rework stars elsewhere.",
  },
  {
    id: "rework",
    label: "Rework dan (mania difficulty)",
    description:
      "Star rating and dan tiers from the mania difficulty port. Needs the rework dan backfill.",
  },
];

export function ratingDisplayOptions() {
  return OPTIONS;
}

function parseMode(raw: string | null): RatingDisplayMode {
  if (raw === "dan" || raw === "sunny" || raw === "osu" || raw === "rework") {
    return raw;
  }
  return "osu";
}

export function getRatingDisplayMode(): RatingDisplayMode {
  try {
    return parseMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "osu";
  }
}

export function setRatingDisplayMode(mode: RatingDisplayMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new Event("roxysu:rating-display"));
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("roxysu:rating-display", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("roxysu:rating-display", onStoreChange);
  };
}

export function useRatingDisplayMode(): RatingDisplayMode {
  return useSyncExternalStore(
    subscribe,
    getRatingDisplayMode,
    () => "osu" as const,
  );
}

export function isFourKKeyCount(keyCount: number | null | undefined): boolean {
  return keyCount != null && Math.round(keyCount) === 4;
}

/** Which dan estimator is shown for the current map + display mode. */
export type PrimaryDanSource = "daniel" | "sunny" | "rework";

/** Daniel out-of-band sentinels like `< Alpha Low` / `> Theta High` — not useful as a display tier. */
export function isOutOfBandDanLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const trimmed = label.trim();
  return trimmed.startsWith("<") || trimmed.startsWith(">");
}

export function primaryDanSource(opts: {
  mode: RatingDisplayMode;
  sunnyEstDiff?: string | null;
  danielEstDiff?: string | null;
  sunnyStar?: number | null;
  danielStar?: number | null;
  reworkEstDiff?: string | null;
  reworkStar?: number | null;
  keyCount?: number | null;
}): PrimaryDanSource | null {
  if (opts.mode === "osu") return null;
  if (opts.mode === "rework") {
    // The rework estimator covers every key mode, so no 4K fallback is needed.
    // Either the stored label or a star is enough to treat the row as rated.
    return opts.reworkEstDiff || opts.reworkStar != null ? "rework" : null;
  }
  if (opts.mode === "dan") {
    if (
      isFourKKeyCount(opts.keyCount) &&
      opts.danielEstDiff &&
      !isOutOfBandDanLabel(opts.danielEstDiff)
    ) {
      return "daniel";
    }
    if (opts.sunnyEstDiff) return "sunny";
    return null;
  }
  if (isFourKKeyCount(opts.keyCount) && opts.danielStar != null) return "daniel";
  if (opts.sunnyStar != null) return "sunny";
  return null;
}

export type PrimaryRatingDisplayLabels = {
  danielDan?: string;
  sunnyDan?: string;
  danielStar?: string;
  sunnyStar?: string;
  reworkDan?: string;
  reworkStar?: string;
};

/** Title for the active dan/sunny display (e.g. panel heading). */
export function primaryRatingDisplayTitle(
  mode: RatingDisplayMode,
  source: PrimaryDanSource | null,
  labels: PrimaryRatingDisplayLabels = {},
): string | null {
  if (mode === "osu" || source == null) return null;
  if (source === "rework") {
    // Rework display mode always shows the dan label as the primary value.
    return labels.reworkDan ?? "Rework dan";
  }
  if (source === "daniel") {
    return mode === "sunny"
      ? (labels.danielStar ?? "Daniel star rating")
      : (labels.danielDan ?? "Daniel dan");
  }
  return mode === "sunny"
    ? (labels.sunnyStar ?? "Sunny star rating")
    : (labels.sunnyDan ?? "Sunny dan");
}

/**
 * Preferred dan label: Daniel on 4K when it is an in-band Alpha+ tier,
 * otherwise Sunny (so Reform / Intro / LN are not hidden by `< Alpha Low`).
 */
export function primaryDanLabel(opts: {
  sunnyEstDiff?: string | null;
  danielEstDiff?: string | null;
  keyCount?: number | null;
}): string | null {
  if (
    isFourKKeyCount(opts.keyCount) &&
    opts.danielEstDiff &&
    !isOutOfBandDanLabel(opts.danielEstDiff)
  ) {
    return opts.danielEstDiff;
  }
  return opts.sunnyEstDiff ?? null;
}

/** Preferred dan star: Daniel on 4K when available, otherwise Sunny. */
export function primaryDanStar(opts: {
  mode?: RatingDisplayMode;
  sunnyStar?: number | null;
  danielStar?: number | null;
  reworkStar?: number | null;
  keyCount?: number | null;
}): number | null {
  if (opts.mode === "rework") return opts.reworkStar ?? null;
  if (isFourKKeyCount(opts.keyCount) && opts.danielStar != null) {
    return opts.danielStar;
  }
  return opts.sunnyStar ?? null;
}

/**
 * Rework ★ → dan label from `dans.json`, recomputed client-side so a floor edit
 * shows up without waiting for the server backfill to relabel.
 */
export function reworkDanLabelFor(opts: {
  reworkStar?: number | null;
  lnRatio?: number | null;
  keyCount?: number | null;
}): string | null {
  if (opts.reworkStar == null || !Number.isFinite(opts.reworkStar)) return null;
  if (opts.keyCount == null) return null;
  return reworkDanLabel(
    opts.reworkStar,
    opts.lnRatio ?? 0,
    Math.round(opts.keyCount),
  );
}

export function formatPrimaryRating(opts: {
  mode: RatingDisplayMode;
  starRating: number | null | undefined;
  sunnyEstDiff?: string | null;
  sunnyStar?: number | null;
  danielEstDiff?: string | null;
  danielStar?: number | null;
  reworkEstDiff?: string | null;
  reworkStar?: number | null;
  lnRatio?: number | null;
  keyCount?: number | null;
}): string {
  if (opts.mode === "rework") {
    // Prefer a client-side label so a dans.json floor edit shows up before
    // relabel. Fall back to the stored label, then the rework star, then osu.
    const label = reworkDanLabelFor(opts) ?? opts.reworkEstDiff ?? null;
    if (label) return label;
    if (opts.reworkStar != null) return formatStars(opts.reworkStar);
    return formatStars(opts.starRating);
  }

  const danLabel = primaryDanLabel(opts);
  const danStar = primaryDanStar(opts);

  switch (opts.mode) {
    case "dan":
      if (danLabel) return danLabel;
      return formatStars(opts.starRating);
    case "sunny":
      if (danStar != null) return formatStars(danStar);
      return formatStars(opts.starRating);
    default:
      return formatStars(opts.starRating);
  }
}

/**
 * Format a 7K skill Sunny ★ value using the Settings rating display mode.
 * Dan mode maps through the RC or LN dan table based on {@link axis}.
 */
export function formatSkillRating(opts: {
  mode: RatingDisplayMode;
  sunnyStar: number | null | undefined;
  axis?: SkillRatingAxis;
}): string {
  const n = opts.sunnyStar;
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";

  if (opts.mode === "dan") {
    const axis = opts.axis ?? "overall";
    return estDiff(n, AXIS_LN_RATIO[axis], SKILL_KEY_COUNT);
  }

  // Skill is always Sunny ★; one decimal matches prior skill UI.
  return `${n.toFixed(1)}★`;
}
