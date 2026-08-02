import { describe, expect, test } from "bun:test";
import { parseBytesRange } from "./serveHashedFile";

describe("parseBytesRange", () => {
  test("absent header → full file", () => {
    expect(parseBytesRange(null, 1000)).toBeNull();
    expect(parseBytesRange(undefined, 1000)).toBeNull();
    expect(parseBytesRange("", 1000)).toBeNull();
  });

  test("open-ended and closed ranges", () => {
    expect(parseBytesRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseBytesRange("bytes=100-", 1000)).toEqual({
      start: 100,
      end: 999,
    });
    expect(parseBytesRange("bytes=500-2000", 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  test("suffix range", () => {
    expect(parseBytesRange("bytes=-100", 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  test("unsatisfiable when start past EOF", () => {
    expect(parseBytesRange("bytes=1000-1001", 1000)).toBe("unsatisfiable");
  });

  test("ignores multi-range (media seeks use one)", () => {
    expect(parseBytesRange("bytes=0-10,20-30", 1000)).toEqual({
      start: 0,
      end: 10,
    });
  });
});
