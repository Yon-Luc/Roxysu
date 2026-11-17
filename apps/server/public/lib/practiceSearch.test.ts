import { describe, expect, test } from "bun:test";
import { parsePracticeSearch, practiceSearchIsEmpty } from "./practiceSearch";

describe("parsePracticeSearch", () => {
  test("reads a query from the URL without requiring storage", () => {
    expect(practiceSearchIsEmpty({})).toBe(true);
    expect(practiceSearchIsEmpty({ q: "key=7" })).toBe(false);
    expect(parsePracticeSearch({ q: "key=7 grade:S", page: "2" })).toMatchObject({
      q: "key=7 grade:S",
      page: 2,
      sortBy: "lastPlayed",
    });
  });
});
