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
    label: "Sunny dan",
    description: "Always show the Sunny dan label when available.",
  },
  {
    id: "sunny",
    label: "Sunny star rating",
    description: "Show Sunny rework stars when available.",
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

export function formatPrimaryRating(opts: {
  mode: RatingDisplayMode;
  starRating: number | null | undefined;
  sunnyEstDiff?: string | null;
  sunnyStar?: number | null;
}): string {
  switch (opts.mode) {
    case "dan":
      if (opts.sunnyEstDiff) return opts.sunnyEstDiff;
      return formatStars(opts.starRating);
    case "sunny":
      if (opts.sunnyStar != null) return formatStars(opts.sunnyStar);
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
