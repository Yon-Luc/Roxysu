import { describe, expect, test } from "bun:test";
import { mirrorPageSuggestsMore } from "./searchOnline";

describe("mirrorPageSuggestsMore", () => {
  test("empty page ends the catalogue", () => {
    expect(mirrorPageSuggestsMore(0)).toBe(false);
  });

  test("short non-empty pages (graveyard-style) still suggest more", () => {
    expect(mirrorPageSuggestsMore(98)).toBe(true);
    expect(mirrorPageSuggestsMore(1)).toBe(true);
  });

  test("full pages suggest more", () => {
    expect(mirrorPageSuggestsMore(100)).toBe(true);
  });
});
