import { useSyncExternalStore } from "react";
import { reworkDanLabel } from "@roxysu/mania-difficulty/dans";
import { formatStars } from "./format";

export type RatingDisplayMode = "osu" | "rework";

/** Skill axes for mapping skill ★ → the matching rework dan table. */
export type SkillRatingAxis = "overall" | "rc" | "ln" | "fln";

const STORAGE_KEY = "roxysu:rating-display";

/** 7K only — skill estimates are 7K. */
const SKILL_KEY_COUNT = 7;

/** Representative LN ratios so reworkDanLabel picks RC vs LN dan tables. */
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
    id: "rework",
    label: "Rework dan (mania difficulty)",
    description:
      "Star rating and dan tiers from the mania difficulty port. Needs the rework dan backfill.",
  },
];

export function ratingDisplayOptions() {
  return OPTIONS;
}

/** Map legacy stored prefs (`dan` / `sunny`) onto rework. */
function parseMode(raw: string | null): RatingDisplayMode {
  if (raw === "osu" || raw === "rework") return raw;
  if (raw === "dan" || raw === "sunny") return "rework";
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
export type PrimaryDanSource = "rework";

/** Out-of-band sentinels like `< Alpha Low` / `> Theta High` — not useful as a display tier. */
export function isOutOfBandDanLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const trimmed = label.trim();
  return trimmed.startsWith("<") || trimmed.startsWith(">");
}

export function primaryDanSource(opts: {
  mode: RatingDisplayMode;
  reworkEstDiff?: string | null;
  reworkStar?: number | null;
}): PrimaryDanSource | null {
  if (opts.mode === "osu") return null;
  // The rework estimator covers every key mode.
  // Either the stored label or a star is enough to treat the row as rated.
  return opts.reworkEstDiff || opts.reworkStar != null ? "rework" : null;
}

export type PrimaryRatingDisplayLabels = {
  reworkDan?: string;
  reworkStar?: string;
};

/** Title for the active rework display (e.g. panel heading). */
export function primaryRatingDisplayTitle(
  mode: RatingDisplayMode,
  source: PrimaryDanSource | null,
  labels: PrimaryRatingDisplayLabels = {},
): string | null {
  if (mode === "osu" || source == null) return null;
  return labels.reworkDan ?? "Rework dan";
}

/** Preferred rework dan label when available. */
export function primaryDanLabel(opts: {
  reworkEstDiff?: string | null;
}): string | null {
  return opts.reworkEstDiff ?? null;
}

/** Preferred rework star when available. */
export function primaryDanStar(opts: {
  reworkStar?: number | null;
}): number | null {
  return opts.reworkStar ?? null;
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

  return formatStars(opts.starRating);
}

/**
 * Format a 7K skill ★ value using the Settings rating display mode.
 * Rework mode maps through the RC or LN dan table based on {@link axis}.
 */
export function formatSkillRating(opts: {
  mode: RatingDisplayMode;
  reworkStar: number | null | undefined;
  axis?: SkillRatingAxis;
}): string {
  const n = opts.reworkStar;
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";

  if (opts.mode === "rework") {
    const axis = opts.axis ?? "overall";
    return reworkDanLabel(n, AXIS_LN_RATIO[axis], SKILL_KEY_COUNT);
  }

  // One decimal matches prior skill UI.
  return `${n.toFixed(1)}★`;
}
