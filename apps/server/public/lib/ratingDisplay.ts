import { useSyncExternalStore } from "react";
import { estDiff } from "@roxysu/sunny-dan";
import { formatStars } from "./format";

export type RatingDisplayMode = "osu" | "dan" | "sunny";

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
];

export function ratingDisplayOptions() {
  return OPTIONS;
}

function parseMode(raw: string | null): RatingDisplayMode {
  if (raw === "dan" || raw === "sunny" || raw === "osu") return raw;
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
export type PrimaryDanSource = "daniel" | "sunny";

export function primaryDanSource(opts: {
  mode: RatingDisplayMode;
  sunnyEstDiff?: string | null;
  danielEstDiff?: string | null;
  sunnyStar?: number | null;
  danielStar?: number | null;
  keyCount?: number | null;
}): PrimaryDanSource | null {
  if (opts.mode === "osu") return null;
  if (opts.mode === "dan") {
    if (isFourKKeyCount(opts.keyCount) && opts.danielEstDiff) return "daniel";
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
};

/** Title for the active dan/sunny display (e.g. panel heading). */
export function primaryRatingDisplayTitle(
  mode: RatingDisplayMode,
  source: PrimaryDanSource | null,
  labels: PrimaryRatingDisplayLabels = {},
): string | null {
  if (mode === "osu" || source == null) return null;
  if (source === "daniel") {
    return mode === "sunny"
      ? (labels.danielStar ?? "Daniel star rating")
      : (labels.danielDan ?? "Daniel dan");
  }
  return mode === "sunny"
    ? (labels.sunnyStar ?? "Sunny star rating")
    : (labels.sunnyDan ?? "Sunny dan");
}

/** Preferred dan label: Daniel on 4K when available, otherwise Sunny. */
export function primaryDanLabel(opts: {
  sunnyEstDiff?: string | null;
  danielEstDiff?: string | null;
  keyCount?: number | null;
}): string | null {
  if (isFourKKeyCount(opts.keyCount) && opts.danielEstDiff) {
    return opts.danielEstDiff;
  }
  return opts.sunnyEstDiff ?? null;
}

/** Preferred dan star: Daniel on 4K when available, otherwise Sunny. */
export function primaryDanStar(opts: {
  sunnyStar?: number | null;
  danielStar?: number | null;
  keyCount?: number | null;
}): number | null {
  if (isFourKKeyCount(opts.keyCount) && opts.danielStar != null) {
    return opts.danielStar;
  }
  return opts.sunnyStar ?? null;
}

export function formatPrimaryRating(opts: {
  mode: RatingDisplayMode;
  starRating: number | null | undefined;
  sunnyEstDiff?: string | null;
  sunnyStar?: number | null;
  danielEstDiff?: string | null;
  danielStar?: number | null;
  keyCount?: number | null;
}): string {
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
