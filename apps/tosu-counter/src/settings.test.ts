import { describe, expect, test } from "bun:test";
import { coerceBoolean, coerceNumber } from "./settings";

describe("coerceBoolean", () => {
  test("reads booleans and common dashboard encodings", () => {
    expect(coerceBoolean(true)).toBe(true);
    expect(coerceBoolean(false)).toBe(false);
    expect(coerceBoolean("true")).toBe(true);
    expect(coerceBoolean("false")).toBe(false);
    expect(coerceBoolean(1)).toBe(true);
    expect(coerceBoolean(0)).toBe(false);
    expect(coerceBoolean("nope")).toBeNull();
  });
});

describe("coerceNumber", () => {
  test("reads numbers and numeric strings from tosu inputs", () => {
    expect(coerceNumber(88)).toBe(88);
    expect(coerceNumber("75")).toBe(75);
    expect(coerceNumber("")).toBeNull();
    expect(coerceNumber("x")).toBeNull();
  });
});
