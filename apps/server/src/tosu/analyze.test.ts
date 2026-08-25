import { describe, expect, test } from "bun:test";
import { conversionCvtFlag } from "./analyze";

describe("conversionCvtFlag", () => {
  test("null for empty / NM / Mirror-only mods", () => {
    expect(conversionCvtFlag(null)).toBeNull();
    expect(conversionCvtFlag("")).toBeNull();
    expect(conversionCvtFlag("[]")).toBeNull();
    expect(conversionCvtFlag(JSON.stringify([{ acronym: "NM" }]))).toBeNull();
    expect(
      conversionCvtFlag(JSON.stringify([{ acronym: "MR" }, { acronym: "CL" }])),
    ).toBeNull();
  });

  test("rate mods alone stay null", () => {
    expect(
      conversionCvtFlag(
        JSON.stringify([{ acronym: "DT", settings: { speed_change: 1.25 } }]),
      ),
    ).toBeNull();
  });

  test("Invert maps to IN", () => {
    expect(conversionCvtFlag(JSON.stringify([{ acronym: "IN" }]))).toBe("IN");
  });

  test("Hold Off maps to HO", () => {
    expect(conversionCvtFlag(JSON.stringify([{ acronym: "HO" }]))).toBe("HO");
  });

  test("combined conversions join in IN-then-HO order", () => {
    expect(
      conversionCvtFlag(
        JSON.stringify([{ acronym: "HO" }, { acronym: "DT" }, { acronym: "IN" }]),
      ),
    ).toBe("IN,HO");
  });
});
