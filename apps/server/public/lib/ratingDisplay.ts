import { useSyncExternalStore } from "react";
import { formatStars } from "./format";

export type RatingDisplayMode = "osu" | "dan" | "sunny";

const STORAGE_KEY = "roxysu:rating-display";

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
