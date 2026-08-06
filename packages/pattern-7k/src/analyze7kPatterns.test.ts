import { describe, expect, test } from "bun:test";
import { PATTERN_ALGORITHM, analyze7kFromOsuText } from "./index.js";

describe("@roxysu/pattern-7k re-exports", () => {
  test("re-exports the active mania pattern algorithm", () => {
    expect(PATTERN_ALGORITHM).toBe("mania-interlude-v1");
    expect(typeof analyze7kFromOsuText).toBe("function");
  });
});
