import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findRepoRootFrom,
  isDevOperator,
} from "./access";
import { skillDelta, withinTolerance } from "./compare";

describe("dev parity access", () => {
  test("operator name is case-insensitive", () => {
    expect(isDevOperator("Noy")).toBe(true);
    expect(isDevOperator(" noy ")).toBe(true);
    expect(isDevOperator("Guest")).toBe(false);
    expect(isDevOperator(null)).toBe(false);
  });

  test("finds the repo that contains the mania-difficulty pin", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = findRepoRootFrom(here);
    expect(root).not.toBeNull();
    expect(root).toBe(path.resolve(here, "../../../.."));
  });
});

describe("skill delta tolerance", () => {
  test("matches the port parity bar (2% or 0.05)", () => {
    expect(withinTolerance(8.198, 8.306)).toBe(true);
    expect(withinTolerance(1.731, 2.147)).toBe(false);
    expect(skillDelta(2.734, 2.736)?.ok).toBe(true);
    expect(skillDelta(null, 1)?.ok).toBeUndefined();
  });
});
