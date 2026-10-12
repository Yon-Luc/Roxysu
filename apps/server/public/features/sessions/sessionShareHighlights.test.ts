import { describe, expect, test } from "bun:test";
import {
  formatSessionDuration,
  pickSessionShareHighlights,
  SESSION_SHARE_HIGHLIGHT_CAP,
} from "./sessionShareHighlights";

function score(
  id: string,
  opts: { isPb?: boolean; pp?: number | null } = {},
) {
  return { id, isPb: opts.isPb ?? false, pp: opts.pp ?? null };
}

describe("pickSessionShareHighlights", () => {
  test("returns empty for empty input", () => {
    expect(pickSessionShareHighlights([])).toEqual([]);
  });

  test("prefers PBs sorted by PP descending", () => {
    const scores = [
      score("a", { isPb: true, pp: 100 }),
      score("b", { isPb: true, pp: 300 }),
      score("c", { isPb: true, pp: 200 }),
    ];
    expect(pickSessionShareHighlights(scores).map((s) => s.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("fills remaining slots with non-PBs by PP", () => {
    const scores = [
      score("pb1", { isPb: true, pp: 150 }),
      score("n1", { pp: 400 }),
      score("n2", { pp: 50 }),
      score("n3", { pp: 200 }),
    ];
    expect(pickSessionShareHighlights(scores, 3).map((s) => s.id)).toEqual([
      "pb1",
      "n1",
      "n3",
    ]);
  });

  test("caps at SESSION_SHARE_HIGHLIGHT_CAP by default", () => {
    const scores = Array.from({ length: 20 }, (_, i) =>
      score(`s${i}`, { isPb: i < 5, pp: 100 - i }),
    );
    expect(pickSessionShareHighlights(scores)).toHaveLength(
      SESSION_SHARE_HIGHLIGHT_CAP,
    );
  });

  test("null PP sorts after numeric PP", () => {
    const scores = [
      score("null-pb", { isPb: true, pp: null }),
      score("hi-pb", { isPb: true, pp: 10 }),
    ];
    expect(pickSessionShareHighlights(scores).map((s) => s.id)).toEqual([
      "hi-pb",
      "null-pb",
    ]);
  });

  test("respects custom cap of 0", () => {
    expect(
      pickSessionShareHighlights([score("a", { isPb: true, pp: 1 })], 0),
    ).toEqual([]);
  });
});

describe("formatSessionDuration", () => {
  test("formats minutes under an hour", () => {
    expect(
      formatSessionDuration(
        "2026-01-01T12:00:00.000Z",
        "2026-01-01T12:45:00.000Z",
      ),
    ).toBe("45m");
  });

  test("formats hours with remainder", () => {
    expect(
      formatSessionDuration(
        "2026-01-01T12:00:00.000Z",
        "2026-01-01T14:20:00.000Z",
      ),
    ).toBe("2h 20m");
  });

  test("formats whole hours", () => {
    expect(
      formatSessionDuration(
        "2026-01-01T12:00:00.000Z",
        "2026-01-01T14:00:00.000Z",
      ),
    ).toBe("2h");
  });

  test("uses now when endedAt is null", () => {
    const start = "2026-01-01T12:00:00.000Z";
    const now = Date.parse("2026-01-01T12:30:00.000Z");
    expect(formatSessionDuration(start, null, now)).toBe("30m");
  });

  test("returns em dash for invalid range", () => {
    expect(
      formatSessionDuration(
        "2026-01-01T14:00:00.000Z",
        "2026-01-01T12:00:00.000Z",
      ),
    ).toBe("—");
  });
});
