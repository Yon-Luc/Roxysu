import { formatModAcronym, parseModEntries } from "@server/replay/mods";
import { t } from "./i18n";

export type RelativeTimeLabels = {
  justNow?: string;
  minutesAgo?: string;
  hoursAgo?: string;
  daysAgo?: string;
};

export function formatAccuracy(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatPp(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(0)}pp`;
}

export function formatScore(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

export function formatMisses(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "FC";
  return `${value}x miss`;
}

export function formatStars(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}★`;
}

/** Format a duration in seconds as `m:ss` (e.g. `3:05`). */
export function formatDurationSeconds(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatRelativeTime(
  iso: string | null | undefined,
  labels?: RelativeTimeLabels | null,
): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return labels?.justNow ?? "just now";
  if (minutes < 60) {
    return labels?.minutesAgo
      ? t(labels.minutesAgo, { n: minutes })
      : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return labels?.hoursAgo
      ? t(labels.hoursAgo, { n: hours })
      : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return labels?.daysAgo ? t(labels.daysAgo, { n: days }) : `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

const CHART_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Short UTC day label for chart axes (avoids full timezone Date#toString). */
export function formatChartDay(value: unknown): string {
  const parts = chartDayParts(value);
  if (!parts) return value == null ? "" : String(value);
  return `${CHART_MONTHS[parts.month]!} ${parts.day}`;
}

function chartDayParts(
  value: unknown,
): { year: number; month: number; day: number } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth(),
      day: value.getUTCDate(),
    };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
    };
  }
  const s = String(value ?? "").trim();
  const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) {
    return {
      year: Number(isoDay[1]),
      month: Number(isoDay[2]) - 1,
      day: Number(isoDay[3]),
    };
  }
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** `m:ss` clock label for seek bars and timestamps. */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** `m:ss.t` clock label with a tenths digit (finer than `formatClock`). */
export function formatClockFrac(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const frac = Math.floor((ms % 1000) / 100);
  return `${m}:${s.toString().padStart(2, "0")}.${frac}`;
}

/** Null-safe `m:ss` duration label; returns "—" for missing/non-finite values. */
export function formatPanelDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatMods(mods: string | null | undefined): string {
  if (!mods || mods === "[]" || mods === "{}") return "NM";
  const entries = parseModEntries(mods);
  if (entries.length === 0) {
    try {
      const parsed = JSON.parse(mods) as unknown;
      if (Array.isArray(parsed) && parsed.length === 0) return "NM";
    } catch {
      // fall through
    }
    return mods;
  }
  return entries.map(formatModAcronym).join(",");
}

/** Text for pasting into osu! song select search. */
export function beatmapSearchText(
  title: string | null | undefined,
  difficultyName?: string | null,
): string {
  const sanitize = (s: string) =>
    s
      .replace(/[\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = sanitize(title?.trim() || "Untitled") || "Untitled";
  const diff = difficultyName ? sanitize(difficultyName.trim()) : "";
  return diff ? `${name} ${diff}` : name;
}
