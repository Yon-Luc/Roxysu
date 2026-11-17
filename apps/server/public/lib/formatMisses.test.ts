import { describe, expect, test } from "bun:test";
import { formatMisses } from "./format";

describe("formatMisses", () => {
  test("pluralizes 0, 1, and 2", () => {
    expect(formatMisses(null)).toBe("—");
    expect(formatMisses(0)).toBe("FC");
    expect(formatMisses(1)).toBe("1 miss");
    expect(formatMisses(2)).toBe("2 misses");
  });

  test("uses dictionary templates when they are passed", () => {
    expect(
      formatMisses(2, { many: "{{count}} ratés" }),
    ).toBe("2 ratés");
  });
});
