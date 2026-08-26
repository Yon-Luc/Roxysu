import { describe, expect, test } from "bun:test";
import {
  EMPTY_CHECKSUM_IDLE_MS,
  emptyChecksumShouldIdle,
  flagsKey,
  keysMismatch,
  shouldScheduleChartLoad,
} from "./chartLoad";

const base = {
  checksum: "aaa",
  flagsKey: "",
  keys: 4 as number | null,
  loadedChecksum: "aaa" as string | null,
  loadedFlags: "" as string | null,
  inFlightChecksum: null as string | null,
  inFlightFlags: null as string | null,
  chartKind: "ready" as const,
  columnCount: 4 as number | null,
};

describe("flagsKey", () => {
  test("sorts acronyms", () => {
    expect(flagsKey(["MR", "IN", "HO"])).toBe("HO,IN,MR");
  });
});

describe("keysMismatch", () => {
  test("detects 4k chart vs 7k live cs", () => {
    expect(keysMismatch(7, 4)).toBe(true);
    expect(keysMismatch(4, 4)).toBe(false);
  });

  test("ignores non-integer / out-of-range cs (std circle size)", () => {
    expect(keysMismatch(4.2, 4)).toBe(false);
    expect(keysMismatch(0, 4)).toBe(false);
    expect(keysMismatch(null, 4)).toBe(false);
  });
});

describe("shouldScheduleChartLoad", () => {
  test("skips when already ready for this checksum and flags", () => {
    expect(shouldScheduleChartLoad(base)).toBe(false);
  });

  test("loads on checksum change", () => {
    expect(
      shouldScheduleChartLoad({ ...base, checksum: "bbb" }),
    ).toBe(true);
  });

  test("loads on IN/HO/MR flag change", () => {
    expect(
      shouldScheduleChartLoad({ ...base, flagsKey: "MR" }),
    ).toBe(true);
  });

  test("retries after a failed fetch (checksum not committed)", () => {
    expect(
      shouldScheduleChartLoad({
        ...base,
        loadedChecksum: null,
        chartKind: "error",
        columnCount: null,
      }),
    ).toBe(true);
  });

  test("retries error even when checksum was previously committed", () => {
    expect(
      shouldScheduleChartLoad({ ...base, chartKind: "error", columnCount: null }),
    ).toBe(true);
  });

  test("reloads when live keys disagree with the parsed column count", () => {
    expect(
      shouldScheduleChartLoad({ ...base, keys: 7, columnCount: 4 }),
    ).toBe(true);
  });

  test("does not stack another fetch while the same chart is in flight", () => {
    expect(
      shouldScheduleChartLoad({
        ...base,
        chartKind: "loading",
        columnCount: null,
        inFlightChecksum: "aaa",
        inFlightFlags: "",
      }),
    ).toBe(false);
  });

  test("does not retry a committed not-mania parse", () => {
    expect(
      shouldScheduleChartLoad({
        ...base,
        chartKind: "not-mania",
        columnCount: null,
      }),
    ).toBe(false);
  });
});

describe("emptyChecksumShouldIdle", () => {
  test("waits out a short blank stretch", () => {
    expect(emptyChecksumShouldIdle(1000, 1200)).toBe(false);
    expect(emptyChecksumShouldIdle(1000, 1000 + EMPTY_CHECKSUM_IDLE_MS)).toBe(
      true,
    );
    expect(emptyChecksumShouldIdle(null, 5000)).toBe(false);
  });
});
