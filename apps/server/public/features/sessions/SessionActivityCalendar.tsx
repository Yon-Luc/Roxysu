import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildActivityGrid,
  localDayKey,
  weekStartsOnMonday,
} from "@server/shared/localDay";

type ActivityDay = { day: string; playCount: number };

/** Empty + 4 green levels via CSS var (Tailwind opacity utilities are unreliable here). */
const INTENSITY_BG = [
  "var(--color-highlight)",
  "color-mix(in srgb, var(--color-chart-cons) 30%, transparent)",
  "color-mix(in srgb, var(--color-chart-cons) 50%, transparent)",
  "color-mix(in srgb, var(--color-chart-cons) 75%, transparent)",
  "var(--color-chart-cons)",
] as const;

function intensityLevel(weight: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (weight <= 0 || max <= 0) return 0;
  const ratio = weight / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function readPlayCount(row: ActivityDay | Record<string, unknown>): number {
  const raw =
    (row as ActivityDay).playCount ??
    (row as { play_count?: unknown }).play_count;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function weekdayLabels(mondayStart: boolean, locale: string): string[] {
  const monday = new Date(2026, 0, 5);
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + (mondayStart ? index : index - 1));
    return fmt.format(date);
  });
}

function monthLabels(
  cells: { day: string }[],
  weeks: number,
  locale: string,
): { weekIndex: number; label: string }[] {
  const labels: { weekIndex: number; label: string }[] = [];
  const fmt = new Intl.DateTimeFormat(locale, { month: "short" });
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const cell = cells[w * 7];
    if (!cell) continue;
    const [year, month, date] = cell.day.split("-").map(Number);
    const when = new Date(year!, (month ?? 1) - 1, date ?? 1);
    if (when.getMonth() !== lastMonth) {
      labels.push({ weekIndex: w, label: fmt.format(when) });
      lastMonth = when.getMonth();
    }
  }
  return labels;
}

/** Local calendar date and timezone offset, refreshed across midnight. */
export function useLocalClock() {
  const read = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset();
    return { tzOffset, todayKey: localDayKey(now, tzOffset) };
  };
  const [clock, setClock] = useState(read);
  useEffect(() => {
    const refresh = () => setClock(read());
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return clock;
}

export type SessionDayStat = {
  day: string;
  /** Plays in sessions that started this local day. */
  plays: number;
};

export function SessionActivityCalendar({
  activity,
  sessionDayStats,
  selectedDay,
  onSelectDay,
  todayKey,
  locale,
  title,
  dayStatsLabel,
  lessLabel,
  moreLabel,
  hint,
}: {
  activity: ActivityDay[];
  /** Per-day aggregates from the sessions list (local start day). */
  sessionDayStats?: SessionDayStat[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  todayKey: string;
  locale?: string;
  title: string;
  dayStatsLabel: (day: string, plays: number, sessions: number) => string;
  lessLabel: string;
  moreLabel: string;
  hint?: string;
}) {
  const weeks = 53;
  const resolvedLocale =
    locale || (typeof navigator !== "undefined" ? navigator.language : "en");
  const weekLocale =
    typeof navigator !== "undefined" ? navigator.language : resolvedLocale;
  const mondayStart = weekStartsOnMonday(weekLocale);
  const labels = weekdayLabels(mondayStart, resolvedLocale);
  const cells = useMemo(
    () => buildActivityGrid({ weeks, todayKey, mondayStart }),
    [todayKey, mondayStart],
  );

  const playByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of activity ?? []) {
      const day = typeof row.day === "string" ? row.day : "";
      if (!day) continue;
      const count = readPlayCount(row);
      if (count > 0) map.set(day, count);
    }
    return map;
  }, [activity]);

  const sessionsByDay = useMemo(() => {
    const sessions = new Map<string, number>();
    const plays = new Map<string, number>();
    for (const row of sessionDayStats ?? []) {
      sessions.set(row.day, (sessions.get(row.day) ?? 0) + 1);
      plays.set(row.day, (plays.get(row.day) ?? 0) + Math.max(0, row.plays));
    }
    return { sessions, plays };
  }, [sessionDayStats]);

  const dayMetrics = useMemo(() => {
    const map = new Map<string, { plays: number; sessions: number; weight: number }>();
    const days = new Set<string>([
      ...playByDay.keys(),
      ...sessionsByDay.sessions.keys(),
    ]);
    for (const day of days) {
      const fromStats = playByDay.get(day) ?? 0;
      const fromSessions = sessionsByDay.plays.get(day) ?? 0;
      const sessions = sessionsByDay.sessions.get(day) ?? 0;
      const plays = fromStats > 0 ? fromStats : fromSessions;
      const weight = plays > 0 ? plays : sessions;
      map.set(day, { plays, sessions, weight });
    }
    return map;
  }, [playByDay, sessionsByDay]);

  const maxWeight = useMemo(() => {
    let max = 0;
    for (const cell of cells) {
      if (cell.future) continue;
      max = Math.max(max, dayMetrics.get(cell.day)?.weight ?? 0);
    }
    return max;
  }, [cells, dayMetrics]);

  const months = useMemo(
    () => monthLabels(cells, weeks, resolvedLocale),
    [cells, resolvedLocale],
  );

  const rows: { day: string; future: boolean }[][] = Array.from(
    { length: 7 },
    () => [],
  );
  for (let w = 0; w < weeks; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const cell = cells[w * 7 + dow];
      if (cell) rows[dow]!.push(cell);
    }
  }

  const gridItems: ReactNode[] = [];
  for (let dow = 0; dow < 7; dow++) {
    gridItems.push(
      <div
        key={`label-${dow}`}
        className="flex items-center justify-end pr-1 text-[9px] leading-none text-muted sm:text-[10px]"
      >
        {labels[dow]}
      </div>,
    );
    for (const cell of rows[dow]!) {
      const metrics = dayMetrics.get(cell.day);
      const plays = metrics?.plays ?? 0;
      const sessions = metrics?.sessions ?? 0;
      const weight = metrics?.weight ?? 0;
      const level = cell.future ? 0 : intensityLevel(weight, maxWeight);
      const selected = selectedDay === cell.day;
      const disabled = cell.future;
      const label = disabled
        ? cell.day
        : dayStatsLabel(cell.day, plays, sessions);
      gridItems.push(
        <button
          key={cell.day}
          type="button"
          disabled={disabled}
          title={label}
          aria-label={label}
          aria-pressed={selected}
          onClick={() => onSelectDay(selected ? null : cell.day)}
          className={[
            "aspect-square w-full min-w-0 rounded-xs transition",
            disabled
              ? "cursor-default opacity-30"
              : "cursor-pointer hover:ring-1 hover:ring-ink/40",
            selected
              ? "ring-2 ring-accent ring-offset-1 ring-offset-surface"
              : "",
          ].join(" ")}
          style={{ backgroundColor: INTENSITY_BG[level] }}
        />,
      );
    }
  }

  return (
    <section className="rx-panel w-full max-w-full px-4 py-4 sm:px-5">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {hint ? <p className="mb-3 mt-0.5 text-xs text-muted">{hint}</p> : <div className="mb-3" />}
      <div className="w-full min-w-0">
        <div className="mb-1 flex gap-0.5 text-[10px] text-muted sm:text-xs">
          <div className="w-9 shrink-0 sm:w-10" />
          <div className="relative h-4 min-w-0 flex-1">
            {months.map((m) => (
              <span
                key={`${m.weekIndex}-${m.label}`}
                className="absolute truncate"
                style={{
                  left: `${(m.weekIndex / weeks) * 100}%`,
                  maxWidth: `${(4 / weeks) * 100}%`,
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div
          className="grid w-full gap-0.5"
          style={{
            gridTemplateColumns: `2.25rem repeat(${weeks}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          }}
        >
          {gridItems}
        </div>

        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
          <span>{lessLabel}</span>
          {INTENSITY_BG.map((bg, i) => (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-xs sm:h-3 sm:w-3"
              style={{ backgroundColor: bg }}
            />
          ))}
          <span>{moreLabel}</span>
        </div>
      </div>
    </section>
  );
}

export function sessionStartedLocalDay(
  startedAt: string,
  tzOffsetMinutes: number,
): string {
  return localDayKey(new Date(startedAt), tzOffsetMinutes);
}
