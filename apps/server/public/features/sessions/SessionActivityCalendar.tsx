import { useMemo } from "react";

type ActivityDay = { day: string; playCount: number };

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;
const INTENSITY_CLASS = [
  "bg-highlight",
  "bg-chart-cons/25",
  "bg-chart-cons/45",
  "bg-chart-cons/70",
  "bg-chart-cons",
] as const;

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function intensityLevel(playCount: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (playCount <= 0 || max <= 0) return 0;
  const ratio = playCount / max;
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
  selectedDay,
  onSelectDay,
  title,
  playsOnDayLabel,
  lessLabel,
  moreLabel,
}: {
  activity: ActivityDay[];
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
    for (const row of activity) map.set(row.day, row.playCount);
    return map;
  }, [activity]);
  const maxPlays = useMemo(() => {
    let max = 0;
    for (const cell of cells) {
      if (cell.future) continue;
      max = Math.max(max, playByDay.get(cell.day) ?? 0);
    }
    return max;
  }, [cells, playByDay]);
  const months = useMemo(() => monthLabels(cells, weeks), [cells]);

  const columns: { day: string; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    columns.push(cells.slice(w * 7, w * 7 + 7));
  }

  return (
    <section className="rx-panel px-4 py-4 sm:px-5">
      <h3 className="mb-3 text-sm font-bold text-ink">{title}</h3>
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-max flex-col gap-1">
          <div className="relative mb-1 h-4 text-xs text-muted">
            {months.map((m) => (
              <span
                key={`${m.weekIndex}-${m.label}`}
                className="absolute"
                style={{ left: `${m.weekIndex * 14 + 28}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <div className="flex w-7 shrink-0 flex-col gap-1 pt-0 text-[10px] leading-3 text-muted">
              {WEEKDAY_LABELS.map((label, i) => (
                <div key={i} className="flex h-3 items-center">
                  {label}
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              {columns.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1">
                  {week.map((cell) => {
                    const count = playByDay.get(cell.day) ?? 0;
                    const level = cell.future
                      ? 0
                      : intensityLevel(count, maxPlays);
                    const selected = selectedDay === cell.day;
                    const disabled = cell.future;
                    return (
                      <button
                        key={cell.day}
                        type="button"
                        disabled={disabled}
                        title={
                          disabled
                            ? cell.day
                            : playsOnDayLabel(cell.day, count)
                        }
                        aria-label={
                          disabled
                            ? cell.day
                            : playsOnDayLabel(cell.day, count)
                        }
                        aria-pressed={selected}
                        onClick={() =>
                          onSelectDay(selected ? null : cell.day)
                        }
                        className={[
                          "h-3 w-3 rounded-[3px] transition",
                          INTENSITY_CLASS[level],
                          disabled
                            ? "cursor-default opacity-30"
                            : "cursor-pointer hover:ring-1 hover:ring-ink/40",
                          selected ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : "",
                        ].join(" ")}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
            <span>{lessLabel}</span>
            {INTENSITY_CLASS.map((cls, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${cls}`} />
            ))}
            <span>{moreLabel}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function sessionStartedUtcDay(startedAt: string): string {
  return new Date(startedAt).toISOString().slice(0, 10);
}
