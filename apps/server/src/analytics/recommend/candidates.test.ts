import { describe, expect, test } from "bun:test";
import {
  FLN_RATIO_THRESHOLD,
  LN_DAN_RATIO_THRESHOLD,
} from "../../map-analysis/estDiff";
import { buildBaseKeymodeFilter } from "./candidates";

describe("buildBaseKeymodeFilter", () => {
  test("binds circle_size to the requested keyCount", () => {
    const four = buildBaseKeymodeFilter(1, 10, null, null, [], 4);
    const seven = buildBaseKeymodeFilter(1, 10, null, null, [], 7);

    expect(four.sql).toContain("b.circle_size = ?");
    expect(seven.sql).toContain("b.circle_size = ?");
    expect(four.params[0]).toBe(4);
    expect(seven.params[0]).toBe(7);
    expect(four.params.slice(1)).toEqual([1, 10]);
    expect(seven.params.slice(1)).toEqual([1, 10]);
  });

  test("adds rice LN-ratio bound", () => {
    const filter = buildBaseKeymodeFilter(2, 8, "rc", null, [], 4);
    expect(filter.sql).toContain("COALESCE(dr.ln_ratio, 0) < ?");
    expect(filter.params).toEqual([4, 2, 8, LN_DAN_RATIO_THRESHOLD]);
  });

  test("adds LN and FLN ratio bounds", () => {
    const ln = buildBaseKeymodeFilter(2, 8, "ln", null, [], 7);
    const fln = buildBaseKeymodeFilter(2, 8, "fln", null, [], 7);
    expect(ln.params).toEqual([
      7,
      2,
      8,
      LN_DAN_RATIO_THRESHOLD,
      FLN_RATIO_THRESHOLD,
    ]);
    expect(fln.params).toEqual([7, 2, 8, FLN_RATIO_THRESHOLD]);
  });

  test("appends overlay SQL and params", () => {
    const filter = buildBaseKeymodeFilter(
      3,
      6,
      null,
      "b.id = ?",
      ["map-1"],
      4,
    );
    expect(filter.sql).toContain("(b.id = ?)");
    expect(filter.params).toEqual([4, 3, 6, "map-1"]);
  });
});
