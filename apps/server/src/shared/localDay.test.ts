import { describe, expect, test } from "bun:test";
import {
  buildActivityGrid,
  calendarWeekday,
  localDayKey,
  localDayRange,
  weekStartsOnMonday,
} from "./localDay";

describe("local day", () => {
  test("00:30 in UTC+1 lands on that local date", () => {
    const instant = new Date("2026-07-14T23:30:00.000Z");
    expect(localDayKey(instant, -60)).toBe("2026-07-15");
    const range = localDayRange("2026-07-15", -60);
    expect(range).not.toBeNull();
    expect(instant.getTime()).toBeGreaterThanOrEqual(range!.start.getTime());
    expect(instant.getTime()).toBeLessThan(range!.end.getTime());
    expect(new Date("2026-07-14T22:30:00.000Z").getTime()).toBeLessThan(
      range!.start.getTime(),
    );
  });

  test("a Monday-start grid begins on Monday and marks days after today", () => {
    const cells = buildActivityGrid({
      weeks: 2,
      todayKey: "2026-07-15",
      mondayStart: true,
    });
    expect(calendarWeekday(cells[0]!.day)).toBe(1);
    expect(cells.some((cell) => cell.day === "2026-07-15" && !cell.future)).toBe(
      true,
    );
    expect(cells.find((cell) => cell.day === "2026-07-16")?.future).toBe(true);
  });

  test("a Sunday-start grid begins on Sunday", () => {
    const cells = buildActivityGrid({
      weeks: 1,
      todayKey: "2026-07-15",
      mondayStart: false,
    });
    expect(calendarWeekday(cells[0]!.day)).toBe(0);
  });

  test("week start follows the locale when the runtime exposes it", () => {
    const monday = weekStartsOnMonday("pt-PT");
    const sunday = weekStartsOnMonday("en-US");
    if (monday === sunday) return;
    expect(monday).toBe(true);
    expect(sunday).toBe(false);
  });
});
