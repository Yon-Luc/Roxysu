const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `Date#getTimezoneOffset` minutes: local = UTC − offset.
 * Lisbon in summer is −60.
 */
export function clampTzOffset(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (rounded < -14 * 60 || rounded > 14 * 60) return 0;
  return rounded;
}

/** Calendar date `YYYY-MM-DD` of an instant in a timezone offset. */
export function localDayKey(instant: Date, tzOffsetMinutes: number): string {
  const shifted = new Date(instant.getTime() - tzOffsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** [start, end) instants for a calendar date at the given offset. */
export function localDayRange(
  day: string,
  tzOffsetMinutes: number,
): { start: Date; end: Date } | null {
  if (!DAY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  const startMs = Date.UTC(year, month - 1, date) + tzOffsetMinutes * 60_000;
  const start = new Date(startMs);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(startMs + 86_400_000) };
}

export function addCalendarDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1));
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a `YYYY-MM-DD` calendar date. */
export function calendarWeekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

type LocaleWithWeek = Intl.Locale & {
  weekInfo?: { firstDay?: number };
  getWeekInfo?: () => { firstDay?: number };
};

/** Monday-first when the locale says so (`Intl.Locale` week info). */
export function weekStartsOnMonday(locale?: string): boolean {
  try {
    const loc = new Intl.Locale(locale ?? "en") as LocaleWithWeek;
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    return info?.firstDay === 1;
  } catch {
    return false;
  }
}

export function buildActivityGrid(opts: {
  weeks: number;
  todayKey: string;
  mondayStart: boolean;
}): { day: string; future: boolean }[] {
  const { weeks, todayKey, mondayStart } = opts;
  const todayDow = calendarWeekday(todayKey);
  const daysUntilWeekEnd = mondayStart
    ? todayDow === 0
      ? 0
      : 7 - todayDow
    : 6 - todayDow;
  const end = addCalendarDays(todayKey, daysUntilWeekEnd);
  const start = addCalendarDays(end, -(weeks * 7 - 1));

  const cells: { day: string; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const day = addCalendarDays(start, i);
    cells.push({ day, future: day > todayKey });
  }
  return cells;
}
