import { describe, expect, test } from "bun:test";
import { reworkLnOnly } from "./analyze";

describe("reworkLnOnly", () => {
  test("false for empty / NM / Mirror-only mods", () => {
    expect(reworkLnOnly(null)).toBe(false);
    expect(reworkLnOnly("")).toBe(false);
    expect(reworkLnOnly("[]")).toBe(false);
    expect(reworkLnOnly(JSON.stringify([{ acronym: "NM" }]))).toBe(false);
    expect(
      reworkLnOnly(JSON.stringify([{ acronym: "MR" }, { acronym: "CL" }])),
    ).toBe(false);
  });

  test("rate mods alone stay false", () => {
    expect(
      reworkLnOnly(
        JSON.stringify([{ acronym: "DT", settings: { speed_change: 1.25 } }]),
      ),
    ).toBe(false);
  });

  test("Invert maps to true", () => {
    expect(reworkLnOnly(JSON.stringify([{ acronym: "IN" }]))).toBe(true);
  });

  test("Hold Off alone stays false (not on rework path)", () => {
    expect(reworkLnOnly(JSON.stringify([{ acronym: "HO" }]))).toBe(false);
  });

  test("Invert with Hold Off is still true", () => {
    expect(
      reworkLnOnly(
        JSON.stringify([{ acronym: "HO" }, { acronym: "DT" }, { acronym: "IN" }]),
      ),
    ).toBe(true);
  });
});
