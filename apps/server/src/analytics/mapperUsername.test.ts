import { describe, expect, test } from "bun:test";
import {
  bumpMapperAgg,
  compareMapperAgg,
  createMapperAgg,
  dominantMapperUsername,
  mapperGroupKey,
  mapperOnlineIdFromGroupKey,
} from "./mapperUsername";

describe("mapperGroupKey", () => {
  test("groups registered mappers by online id", () => {
    expect(mapperGroupKey(12345, "Alice")).toBe("id:12345");
    expect(mapperGroupKey(12345, "Renamed")).toBe("id:12345");
  });

  test("groups guest mappers by username", () => {
    expect(mapperGroupKey(0, "GuestMapper")).toBe("name:guestmapper");
    expect(mapperGroupKey(null, "GuestMapper")).toBe("name:guestmapper");
  });

  test("ignores rows with no usable identity", () => {
    expect(mapperGroupKey(0, null)).toBeNull();
    expect(mapperGroupKey(null, "   ")).toBeNull();
  });
});

describe("dominantMapperUsername", () => {
  test("picks the most-played username", () => {
    const agg = createMapperAgg();
    bumpMapperAgg(agg, 1, 0, "OldName");
    bumpMapperAgg(agg, 1, 0, "OldName");
    bumpMapperAgg(agg, 1, 0, "NewName");
    expect(dominantMapperUsername(agg.usernameCounts)).toBe("OldName");
  });

  test("breaks ties alphabetically", () => {
    const counts = new Map([
      ["Zeta", 2],
      ["Alpha", 2],
    ]);
    expect(dominantMapperUsername(counts)).toBe("Alpha");
  });
});

describe("compareMapperAgg", () => {
  test("sorts by play count then pp then username", () => {
    const a = createMapperAgg();
    bumpMapperAgg(a, 1, 10, "MapperA");
    bumpMapperAgg(a, 1, 0, "MapperA");

    const b = createMapperAgg();
    bumpMapperAgg(b, 1, 5, "MapperB");
    bumpMapperAgg(b, 1, 0, "MapperB");

    expect(compareMapperAgg(a, b)).toBeLessThan(0);
    expect(mapperOnlineIdFromGroupKey("id:99")).toBe(99);
    expect(mapperOnlineIdFromGroupKey("name:foo")).toBe(0);
  });
});
