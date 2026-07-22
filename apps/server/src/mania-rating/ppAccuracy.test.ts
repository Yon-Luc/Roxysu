import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PP_ACCURACY,
  PP_ACCURACY_TIERS,
  hasCompletePpByAccuracy,
  parsePpAccuracyParam,
  parsePpByAccuracy,
  ppAtAccuracy,
  ppAccuracyKey,
  sqlPpAtAccuracy,
} from "./ppAccuracy";

describe("ppAccuracy helpers", () => {
  test("tiers and keys are stable", () => {
    expect([...PP_ACCURACY_TIERS]).toEqual([100, 99.5, 97, 95, 93]);
    expect(ppAccuracyKey(100)).toBe("100");
    expect(ppAccuracyKey(99.5)).toBe("99.5");
    expect(DEFAULT_PP_ACCURACY).toBe(100);
  });

  test("parsePpAccuracyParam accepts known tiers", () => {
    expect(parsePpAccuracyParam(99.5)).toBe(99.5);
    expect(parsePpAccuracyParam("97")).toBe(97);
    expect(parsePpAccuracyParam("nope")).toBe(100);
    expect(parsePpAccuracyParam(undefined)).toBe(100);
  });

  test("hasCompletePpByAccuracy requires all tiers", () => {
    const full = {
      "100": 1,
      "99.5": 2,
      "97": 3,
      "95": 4,
      "93": 5,
    };
    expect(hasCompletePpByAccuracy(full)).toBe(true);
    expect(hasCompletePpByAccuracy({ "100": 1 })).toBe(false);
    expect(hasCompletePpByAccuracy(null)).toBe(false);
  });

  test("ppAtAccuracy falls back to ppSs for 100%", () => {
    expect(ppAtAccuracy(null, 100, 412)).toBe(412);
    expect(ppAtAccuracy({ "100": 400 }, 100, 412)).toBe(400);
    expect(ppAtAccuracy({ "95": 200 }, 95, 412)).toBe(200);
    expect(ppAtAccuracy(null, 95, 412)).toBeNull();
  });

  test("parsePpByAccuracy ignores non-finite values", () => {
    expect(parsePpByAccuracy('{"100":10,"95":"x"}')).toEqual({ "100": 10 });
    expect(parsePpByAccuracy("not-json")).toBeNull();
  });

  test("sqlPpAtAccuracy uses COALESCE for SS", () => {
    expect(sqlPpAtAccuracy("base", "100")).toContain("COALESCE");
    expect(sqlPpAtAccuracy("exp", "95")).toBe(
      "json_extract(exp.pp_by_accuracy_json, '$.95')",
    );
  });
});
