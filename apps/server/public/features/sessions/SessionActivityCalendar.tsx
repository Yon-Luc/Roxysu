import { useMemo } from "react";

type ActivityDay = { day: string; playCount: number };

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;

/** Empty + 4 green levels via CSS var (Tailwind opacity utilities are unreliable here). */
const INTENSITY_BG = [
  "var(--color-highlight)",
  "color-mix(in srgb, var(--color-chart-cons) 30%, transparent)",
  "color-mix(in srgb, var(--color-chart-cons) 50%, transparent)",
  "color-mix(in srgb, var(--color-chart-cons) 75%, transparent)",
  "var(--color-chart-cons)",
] as const;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function intensityLevel(weight: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (weight <= 0 || max <= 0) return 0;
  const ratio = weight / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function buildWeekGrid(weeks: number): { day: string; future: boolean }[] {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  let start = addUtcDays(today, -(weeks * 7 - 1));
  start = addUtcDays(start, -start.getUTCDay());
  const end = addUtcDays(start, weeks * 7 - 1);

  const cells: { day: string; future: boolean }[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addUtcDays(d, 1)) {
    cells.push({
      day: utcDayKey(d),
      future: d.getTime() > today.getTime(),
    });
  }
  return cells;
}

function monthLabels(
  cells: { day: string }[],
  weeks: number,
): { weekIndex: number; label: string }[] {
  const labels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const cell = cells[w * 7];
    if (!cell) continue;
    const month = Number(cell.day.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      labels.push({
        weekIndex: w,
        label: new Date(`${cell.day}T00:00:00.000Z`).toLocaleString(undefined, {
          month: "short",
          timeZone: "UTC",
        }),
      });
      lastMonth = month;
    }
  }
  return labels;
}

export function SessionActivityCalendar({
  activity,
  sessionDays,
  selectedDay,
  onSelectDay,
  title,
  playsOnDayLabel,
  lessLabel,
  moreLabel,
}: {
  activity: ActivityDay[];
  /** UTC days that have at least one session (from list payload). */
  sessionDays?: Iterable<string>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  title: string;
  playsOnDayLabel: (day: string, count: number) => string;
  lessLabel: string;
  moreLabel: string;
}) {
  const weeks = 53;
  const cells = useMemo(() => buildWeekGrid(weeks), []);
  const playByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of activity) {
      if (row.playCount > 0) map.set(row.day, row.playCount);
    }
    return map;
  }, [activity]);
  const sessionsByDay = useMemo(() => {
    const set = new Set<string>();
    if (sessionDays) {
      for (const day of sessionDays) set.add(day);
    }
    return set;
  }, [sessionDays]);

  /** Prefer play counts; fall back to 1 when a session exists that day but stats are missing. */
  const weightByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, count] of playByDay) map.set(day, count);
    for (const day of sessionsByDay) {
      if ((map.get(day) ?? 0) <= 0) map.set(day, 1);
    }
    return map;
  }, [playByDay, sessionsByDay]);

  const maxWeight = useMemo(() => {
    let max = 0;
    for (const cell of cells) {
      if (cell.future) continue;
      max = Math.max(max, weightByDay.get(cell.day) ?? 0);
    }
    return max;
  }, [cells, weightByDay]);
  const months = useMemo(() => monthLabels(cells, weeks), [cells]);

  const columns: { day: string; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    columns.push(cells.slice(w * 7, w * 7 + 7));
  }

  return (
    <section className="rx-panel w-full max-w-full px-4 py-4 sm:px-5">
      <h3 className="mb-3 text-sm font-bold text-ink">{title}</h3>
      <div className="w-full min-w-0">
        <div className="mb-1 flex gap-[2px] text-[10px] text-muted sm:text-xs">
          <div className="w-7 shrink-0" />
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

        <div className="flex gap-[2px]">
          <div className="flex w-7 shrink-0 flex-col gap-[2px] text-[9px] leading-none text-muted sm:text-[10px]">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="flex flex-1 items-center"
                style={{ aspectRatio: "1 / 1" }}
              >
                {label}
              </div>
            ))}
          </div>

          <div
            className="grid min-w-0 flex-1 gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((week, wi) => (
              <div key={wi} className="flex min-w-0 flex-col gap-[2px]">
                {week.map((cell) => {
                  const plays = playByDay.get(cell.day) ?? 0;
                  const weight = weightByDay.get(cell.day) ?? 0;
                  const level = cell.future
                    ? 0
                    : intensityLevel(weight, maxWeight);
                  const selected = selectedDay === cell.day;
                  const disabled = cell.future;
                  const tooltipCount =
                    plays > 0 ? plays : sessionsByDay.has(cell.day) ? 1 : 0;
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      disabled={disabled}
                      title={
                        disabled
                          ? cell.day
                          : playsOnDayLabel(cell.day, tooltipCount)
                      }
                      aria-label={
                        disabled
                          ? cell.day
                          : playsOnDayLabel(cell.day, tooltipCount)
                      }
                      aria-pressed={selected}
                      onClick={() => onSelectDay(selected ? null : cell.day)}
                      className={[
                        "aspect-square w-full rounded-[2px] transition",
                        disabled
                          ? "cursor-default opacity-30"
                          : "cursor-pointer hover:ring-1 hover:ring-ink/40",
                        selected
                          ? "ring-2 ring-accent ring-offset-1 ring-offset-surface"
                          : "",
                      ].join(" ")}
                      style={{ backgroundColor: INTENSITY_BG[level] }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
          <span>{lessLabel}</span>
          {INTENSITY_BG.map((bg, i) => (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-[2px] sm:h-3 sm:w-3"
              style={{ backgroundColor: bg }}
            />
          ))}
          <span>{moreLabel}</span>
        </div>
      </div>
    </section>
  );
}

export function sessionStartedUtcDay(startedAt: string): string {
  return new Date(startedAt).toISOString().slice(0, 10);
}
