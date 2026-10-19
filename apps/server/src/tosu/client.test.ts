import { describe, expect, test } from "bun:test";
import { keysFromCs, parseTosuV2Message } from "./client";

describe("keysFromCs", () => {
  test("reads a bare number", () => {
    expect(keysFromCs(7)).toBe(7);
  });

  test("prefers converted when it is a 1-10 key count", () => {
    expect(keysFromCs({ original: 7, converted: 4 })).toBe(4);
  });

  test("falls back to original when converted is 0 / unused", () => {
    expect(keysFromCs({ original: 7, converted: 0 })).toBe(7);
  });

  test("null for missing or malformed values", () => {
    expect(keysFromCs(undefined)).toBeNull();
    expect(keysFromCs("7")).toBeNull();
    expect(keysFromCs({})).toBeNull();
  });
});

describe("parseTosuV2Message key count", () => {
  const msg = (cs: unknown) =>
    JSON.stringify({
      state: { number: 5, name: "selectPlay" },
      beatmap: {
        checksum: "abc",
        mode: { number: 3, name: "mania" },
        stats: { cs },
      },
    });

  test("numeric cs", () => {
    expect(parseTosuV2Message(msg(7))?.beatmap.keys).toBe(7);
  });

  test("object cs uses converted key count", () => {
    expect(
      parseTosuV2Message(msg({ original: 7, converted: 4 }))?.beatmap.keys,
    ).toBe(4);
  });

  test("object cs falls back to original", () => {
    expect(
      parseTosuV2Message(msg({ original: 7, converted: 0 }))?.beatmap.keys,
    ).toBe(7);
  });
});
