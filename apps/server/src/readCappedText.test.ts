import { describe, expect, test } from "bun:test";
import { readResponseTextCapped } from "./readCappedText";

describe("readResponseTextCapped", () => {
  test("returns a short body", async () => {
    expect(await readResponseTextCapped(new Response("ab"), 8)).toBe("ab");
  });

  test("returns null over the cap", async () => {
    expect(await readResponseTextCapped(new Response("abcdef"), 3)).toBeNull();
  });
});
