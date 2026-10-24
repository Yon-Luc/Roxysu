import { describe, expect, test } from "bun:test";
import { skillProfile, MAX_SKILL_WINDOWS } from "../../src/skillProfile";
import {
  expandDanTiers,
  expandReworkDanMatch,
  reworkDanIntervalForStar,
  reworkDanIntervalTable,
  reworkDanLabel,
  reworkDanNextTierName,
  reworkDanTierNames,
  reworkDanTiersFor,
  validateDanConfig,
  REWORK_DAN_BANDS,
  REWORK_LN_RATIO_THRESHOLD,
  REWORK_UNKNOWN_DAN,
  type DanConfig,
} from "../../src/dans";

const config = (over: Partial<DanConfig> = {}): DanConfig => ({
  bands: ["low", "mid/low", "mid", "mid/high", "high"],
  tables: {
    4: {
      rice: [
        { name: "Alpha", id: "Alpha", floor: 6.5 },
        { name: "Alpha+", id: "Alpha", floor: 7.0 },
        { name: "Beta", id: "Beta", floor: 8.0, ceiling: 9.0 },
      ],
      ln: [],
    },
  },
  ...over,
});

describe("validateDanConfig", () => {
  test("shipped dans.json is valid", () => {
    expect(validateDanConfig()).toEqual([]);
  });

  test("rejects non-increasing floors", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", id: "A", floor: 7 },
              { name: "B", id: "B", floor: 7 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain("must be greater than the previous tier floor");
  });

  test("rejects an id that names no tier of the table", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6 },
              { name: "B", id: "Z", floor: 7 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain('"Z" must name a tier');
  });

  test("accepts sub-levels that precede their base tier row", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A-", id: "A", floor: 6 },
              { name: "A", floor: 7 },
              { name: "A+", id: "A", floor: 8 },
              { name: "B", floor: 9, ceiling: 10 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors).toEqual([]);
  });

  test("rejects an id that breaks group contiguity", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6 },
              { name: "A+", id: "A", floor: 7 },
              { name: "B", floor: 8 },
              { name: "A++", id: "A", floor: 9 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain('"A" group must be contiguous');
  });

  test("accepts contiguous sub-levels grouped under a base id", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6 },
              { name: "A+", id: "A", floor: 7 },
              { name: "A++", id: "A", floor: 7.5 },
              { name: "B", floor: 8, ceiling: 9 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors).toEqual([]);
  });

  test("rejects a ceiling on a non-final tier", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6, ceiling: 9 },
              { name: "B", floor: 8 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain("only the last tier may set a ceiling");
  });

  test("rejects an alias that shadows a tier name of the table", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6, aliases: ["B"] },
              { name: "B", floor: 7 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain('"B" must not shadow a tier name');
  });

  test("rejects a duplicated alias within a table", () => {
    const errors = validateDanConfig(
      config({
        tables: {
          4: {
            rice: [
              { name: "A", floor: 6, aliases: ["X"] },
              { name: "B", floor: 7, aliases: ["X"] },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain("is already used for A");
  });

  test("rejects an alias starting with a sentinel marker", () => {
    const errors = validateDanConfig(
      config({ tables: { 4: { rice: [{ name: "A", floor: 6, aliases: [">A"] }], ln: [] } } }),
    );
    expect(errors.join(" ")).toContain("must not start with < or >");
  });

  test("requires at least one rice tier per key count", () => {
    const errors = validateDanConfig(
      config({ tables: { 6: { rice: [], ln: [] } } }),
    );
    expect(errors.join(" ")).toContain("at least one tier");
  });

  test("rejects a non-numeric key count", () => {
    const errors = validateDanConfig(
      config({ tables: { mania: { rice: [{ name: "A", floor: 1 }], ln: [] } } }),
    );
    expect(errors.join(" ")).toContain("key count must be numeric");
  });
});

describe("expandDanTiers", () => {
  test("splits each span into every band, contiguous", () => {
    const rows = expandDanTiers([
      { name: "Alpha", floor: 6 },
      { name: "Beta", floor: 8, ceiling: 9 },
    ]);
    // 2 tiers × 5 bands
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual([6, 6.4, "Alpha low"]);
    expect(rows[4]![2]).toBe("Alpha high");
    expect(rows[5]![2]).toBe("Beta low");
    // last tier's final band keeps the declared ceiling
    expect(rows[9]).toEqual([8.8, 9, "Beta high"]);
    // no gaps between bands
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]![0]).toBeCloseTo(rows[i - 1]![1], 9);
    }
  });

  test("a single final tier without a ceiling is an open-ended sentinel", () => {
    const rows = expandDanTiers([{ name: "Ω", floor: 9 }]);
    expect(rows).toEqual([[9, Infinity, "Ω"]]);
  });

  test("empty tiers or bands produce nothing", () => {
    expect(expandDanTiers([])).toEqual([]);
    expect(expandDanTiers([{ name: "A", floor: 1 }], [])).toEqual([]);
  });
});

describe("table selection", () => {
  test("ln tiers are used at/above the ratio threshold", () => {
    expect(reworkDanTierNames(4, "ln")).toContain("LN 13");
    expect(reworkDanTierNames(4, "rice")).toContain("Reform 10");
    expect(reworkDanLabel(7.5, REWORK_LN_RATIO_THRESHOLD, 4)).toContain("LN 13");
    expect(reworkDanLabel(7.9, REWORK_LN_RATIO_THRESHOLD - 0.01, 4)).toContain(
      "γ",
    );
  });

  test("empty ln table falls back to rice tiers", () => {
    // 7K declares no ln tiers, so 7K LN maps onto the rice table.
    expect(reworkDanTierNames(7, "ln")).toEqual(reworkDanTierNames(7, "rice"));
  });

  test("sub-level tiers carry their base tier id", () => {
    const tiers = reworkDanTiersFor(7, "rice")!;
    expect(tiers.find((t) => t.name === "Regular 7++")!.id).toBe("Regular 7");
    expect(tiers.find((t) => t.name === "Regular 9-")!.id).toBe("Regular 9");
    expect(tiers.find((t) => t.name === "Regular Ψ")!.id).toBe("Regular Ψ");
    expect(reworkDanTiersFor(4, "rice")!.find((t) => t.name === "Reform 10")!.id).toBe("Reform 10");
  });

  test("unmapped key count is unknown", () => {
    expect(reworkDanIntervalTable(0, 6)).toBeNull();
    expect(reworkDanLabel(9, 0, 6)).toBe(REWORK_UNKNOWN_DAN);
  });
});

describe("reworkDanLabel", () => {
  test("maps 4K rice floors to the requested dan", () => {
    expect(reworkDanLabel(6.5, 0, 4)).toContain("Reform 10");
    expect(reworkDanLabel(6.95, 0, 4)).toContain("α");
    expect(reworkDanLabel(7.3, 0, 4)).toContain("β");
    expect(reworkDanLabel(7.9, 0, 4)).toContain("γ");
    expect(reworkDanLabel(8.6, 0, 4)).toContain("δ");
    expect(reworkDanLabel(9.8, 0, 4)).toContain("ε");
    expect(reworkDanLabel(10.8, 0, 4)).toContain("ζ");
    expect(reworkDanLabel(12.2, 0, 4)).toContain("η");
  });

  test("maps 4K ln floors to the requested dan", () => {
    expect(reworkDanLabel(7.3, 0.5, 4)).toContain("LN 13");
    expect(reworkDanLabel(8.3, 0.5, 4)).toContain("LN 14");
    expect(reworkDanLabel(10.6, 0.5, 4)).toContain("LN 18");
  });

  test("maps 7K floors through the sub-level ladder", () => {
    expect(reworkDanLabel(8.61, 0, 7)).toContain("Regular γ--");
    expect(reworkDanLabel(8.8, 0, 7)).toBe("Regular γ low");
    expect(reworkDanLabel(9.4, 0, 7)).toContain("Regular Ψ");
    expect(reworkDanLabel(10.9, 0, 7)).toContain("Regular ζ++");
    expect(reworkDanLabel(11.6, 0, 7)).toContain("Regular ★+");
    expect(reworkDanLabel(12.1, 0, 7)).toContain("Regular ∞-");
    expect(reworkDanLabel(13.5, 0, 7)).toBe("Regular >∞");
  });

  test("below the first floor is an under-band sentinel", () => {
    expect(reworkDanLabel(2.5, 0, 4)).toBe(`< Reform 1 ${REWORK_DAN_BANDS[0]}`);
    expect(reworkDanLabel(7.1, 0.5, 4)).toBe(`< LN 13 ${REWORK_DAN_BANDS[0]}`);
    expect(reworkDanLabel(4.3, 0, 7)).toBe(
      `< Regular 1 ${REWORK_DAN_BANDS[0]}`,
    );
    expect(reworkDanLabel(7.05, 0, 7)).toBe(`Regular 6++ high`);
  });

  test("the open-ended sentinel tier labels with its bare name above 4K high range", () => {
    expect(reworkDanLabel(13.5, 0, 4)).toBe(">θ");
    expect(reworkDanLabel(11.6, 0.5, 4)).toBe("LN >18");
  });

  test("each dan exposes all five bands in order", () => {
    // β spans [7.2, 7.8) — probe each band's midpoint.
    const tier = "β";
    const seen = [7.26, 7.38, 7.5, 7.62, 7.74].map((sr) =>
      reworkDanLabel(sr, 0, 4),
    );
    expect(seen.filter((l) => l.startsWith(tier))).toHaveLength(
      REWORK_DAN_BANDS.length,
    );
    expect(new Set(seen).size).toBe(REWORK_DAN_BANDS.length);
    expect(seen.map((l) => l.split(" ")[1])).toEqual([...REWORK_DAN_BANDS]);
  });
});

describe("expandReworkDanMatch", () => {
  test("a base-row alias covers every sub-level of its group", () => {
    expect(expandReworkDanMatch("Gamma")).toEqual([
      "γ",
      "Regular γ--",
      "Regular γ-",
      "Regular γ",
      "Regular γ+",
      "Regular γ++",
    ]);
    // Case-insensitive; group-scoped spellings resolve to the same set.
    expect(expandReworkDanMatch("  Regular GAMMA ")).toEqual(
      expandReworkDanMatch("Regular Gamma"),
    );
  });

  test("the bare symbol is searchable", () => {
    expect(expandReworkDanMatch("ψ")).toEqual([
      "Regular Ψ--",
      "Regular Ψ-",
      "Regular Ψ",
      "Regular Ψ+",
      "Regular Ψ++",
    ]);
    expect(expandReworkDanMatch("α")).toEqual(["α"]);
  });

  test("a group id resolves to its members", () => {
    expect(expandReworkDanMatch("Regular ∞")).toEqual([
      "Regular ∞--",
      "Regular ∞-",
      "Regular ∞",
    ]);
  });

  test("a sub-level or plain tier name resolves to itself", () => {
    expect(expandReworkDanMatch("Regular ζ++")).toEqual(["Regular ζ++"]);
    expect(expandReworkDanMatch("Reform 10")).toEqual(["Reform 10"]);
    expect(expandReworkDanMatch("LN 14")).toEqual(["LN 14"]);
  });

  test("sentinel-marked and unresolved tokens stay generic", () => {
    expect(expandReworkDanMatch(">θ")).toBeNull();
    expect(expandReworkDanMatch("< Reform 1 low")).toBeNull();
    // Spelled sentinel aliases resolve like any other member.
    expect(expandReworkDanMatch("Over Theta")).toEqual([">θ"]);
    expect(expandReworkDanMatch("Over Aeternium")).toEqual(["Regular >∞"]);
    expect(expandReworkDanMatch("zz")).toBeNull();
  });

  test("one spelled name spans both key modes safely", () => {
    expect(expandReworkDanMatch("ζ")).toEqual([
      "ζ",
      "Regular ζ--",
      "Regular ζ-",
      "Regular ζ",
      "Regular ζ+",
      "Regular ζ++",
    ]);
    // Key modes diverge on spelled names: 4K uses Zeta, 7K uses Zenith.
    expect(expandReworkDanMatch("Zeta")).toContain("ζ");
    expect(expandReworkDanMatch("Regular Zenith")).not.toContain("ζ");
  });
});

describe("reworkDanIntervalForStar", () => {
  test("returns null below the table start or for unmapped key counts", () => {
    expect(reworkDanIntervalForStar(1, 0, 4)).toBeNull();
    expect(reworkDanIntervalForStar(9, 0, 6)).toBeNull();
  });

  test("inclusive lower bound, exclusive upper bound", () => {
    const first = reworkDanIntervalForStar(6.5, 0, 4);
    expect(first?.[2]).toContain("Reform 10");
    expect(first?.[2]).toContain("low");
  });

  test("the open-ended sentinel matches everything above it", () => {
    const last = reworkDanIntervalForStar(99, 0, 4);
    expect(last?.[2]).toBe(">θ");
    expect(last?.[1]).toBe(Infinity);
  });
});

describe("reworkDanNextTierName", () => {
  test("names the first tier above the star", () => {
    expect(reworkDanNextTierName(6.4, 0, 4)).toBe("Reform 10");
    expect(reworkDanNextTierName(6.6, 0, 4)).toBe("α");
    expect(reworkDanNextTierName(6.95, 0, 4)).toBe("β");
    expect(reworkDanNextTierName(12.5, 0, 4)).toBe("θ");
    expect(reworkDanNextTierName(13.4, 0, 4)).toBeNull();
    expect(reworkDanNextTierName(12.5, 0, 7)).toBe("Regular >∞");
  });
});

describe("reworkDanTiersFor", () => {
  test("returns null for an unknown key count", () => {
    expect(reworkDanTiersFor(6, "rice")).toBeNull();
  });
});
describe("window guards", () => {
  test("skillProfile with windowMs null allocates no windows", () => {
    const p = skillProfile(
      {
        columnCount: 4,
        overallDifficulty: 8,
        notes: Array.from({ length: 200 }, (_, i) => ({
          column: i % 4,
          startMs: 1000 + i * 70,
          endMs: 1000 + i * 70,
        })),
      },
      { windowMs: null },
    );
    expect(p.windows).toEqual([]);
    expect(p.dominant).not.toBeNull();
    expect(p.starRating).toBe(p.attributes.starRating);
  });

  test("a malformed final timestamp cannot allocate unbounded windows", () => {
    const notes = Array.from({ length: 50 }, (_, i) => ({
      column: i % 7,
      startMs: 1000 + i * 70,
      endMs: 1000 + i * 70,
    }));
    // Note far in the future (corrupt chart / editor junk).
    notes.push({ column: 3, startMs: 2_147_483_647, endMs: 2_147_483_647 });

    const p = skillProfile(
      { columnCount: 7, overallDifficulty: 8, notes },
      { windowMs: 2000 },
    );
    expect(p.windows.length).toBeLessThanOrEqual(MAX_SKILL_WINDOWS);
    expect(p.windows.length).toBeGreaterThan(0);
    // Chart-level classification still comes from the real skill stars.
    expect(p.starRating).toBeGreaterThan(0);
  });
});
