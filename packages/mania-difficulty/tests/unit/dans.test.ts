import { describe, expect, test } from "bun:test";
import { skillProfile, MAX_SKILL_WINDOWS } from "../../src/skillProfile";
import {
  expandDanTiers,
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
        { name: "Alpha", floor: 6.5 },
        { name: "Beta", floor: 7.0, ceiling: 8.0 },
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
              { name: "A", floor: 7 },
              { name: "B", floor: 7 },
            ],
            ln: [],
          },
        },
      }),
    );
    expect(errors.join(" ")).toContain("must be greater than the previous tier floor");
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

  test("empty tiers or bands produce nothing", () => {
    expect(expandDanTiers([])).toEqual([]);
    expect(expandDanTiers([{ name: "A", floor: 1 }], [])).toEqual([]);
  });
});

describe("table selection", () => {
  test("ln tiers are used at/above the ratio threshold", () => {
    expect(reworkDanTierNames(4, "ln")).toContain("LN 13");
    expect(reworkDanTierNames(4, "rice")).toContain("Alpha");
    expect(reworkDanLabel(7.5, REWORK_LN_RATIO_THRESHOLD, 4)).toContain("LN 13");
    expect(reworkDanLabel(7.9, REWORK_LN_RATIO_THRESHOLD - 0.01, 4)).toContain(
      "Gamma",
    );
  });

  test("empty ln table falls back to rice tiers", () => {
    // 7K declares no ln tiers, so 7K LN maps onto the rice table.
    expect(reworkDanTierNames(7, "ln")).toEqual(reworkDanTierNames(7, "rice"));
  });

  test("unmapped key count is unknown", () => {
    expect(reworkDanIntervalTable(0, 6)).toBeNull();
    expect(reworkDanLabel(9, 0, 6)).toBe(REWORK_UNKNOWN_DAN);
  });
});

describe("reworkDanLabel", () => {
  test("maps 4K rice floors to the requested dan", () => {
    expect(reworkDanLabel(6.5, 0, 4)).toContain("Reform 10");
    expect(reworkDanLabel(6.95, 0, 4)).toContain("Alpha");
    expect(reworkDanLabel(7.3, 0, 4)).toContain("Beta");
    expect(reworkDanLabel(7.9, 0, 4)).toContain("Gamma");
    expect(reworkDanLabel(8.6, 0, 4)).toContain("Delta");
    expect(reworkDanLabel(9.8, 0, 4)).toContain("Epsilon");
    expect(reworkDanLabel(10.8, 0, 4)).toContain("Zeta");
    expect(reworkDanLabel(12.2, 0, 4)).toContain("Eta");
  });

  test("maps 4K ln floors to the requested dan", () => {
    expect(reworkDanLabel(7.3, 0.5, 4)).toContain("LN 13");
    expect(reworkDanLabel(8.3, 0.5, 4)).toContain("LN 14");
    expect(reworkDanLabel(10.6, 0.5, 4)).toContain("LN 18");
  });

  test("maps 7K floors to gamma through stellium", () => {
    expect(reworkDanLabel(8.8, 0, 7)).toContain("Regular Gamma");
    expect(reworkDanLabel(9.4, 0, 7)).toContain("Regular Azimuth");
    expect(reworkDanLabel(10.9, 0, 7)).toContain("Regular Zenith");
    expect(reworkDanLabel(11.6, 0, 7)).toContain("Regular Stellium");
  });

  test("below the first floor is an under-band sentinel", () => {
    expect(reworkDanLabel(6.4, 0, 4)).toBe(`< Reform 10 ${REWORK_DAN_BANDS[0]}`);
    expect(reworkDanLabel(7.1, 0.5, 4)).toBe(`< LN 13 ${REWORK_DAN_BANDS[0]}`);
    expect(reworkDanLabel(8.6, 0, 7)).toBe(
      `< Regular Gamma ${REWORK_DAN_BANDS[0]}`,
    );
  });

  test("above the last ceiling is an over-band sentinel", () => {
    const last = REWORK_DAN_BANDS[REWORK_DAN_BANDS.length - 1];
    expect(reworkDanLabel(13.1, 0, 4)).toBe(`> Eta ${last}`);
    expect(reworkDanLabel(11.6, 0.5, 4)).toBe(`> LN 18 ${last}`);
    expect(reworkDanLabel(12.1, 0, 7)).toBe(`> Regular Stellium ${last}`);
  });

  test("each dan exposes all five bands in order", () => {
    // Beta spans [7.2, 7.8) — probe each band's midpoint.
    const tier = "Beta";
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

describe("reworkDanIntervalForStar", () => {
  test("returns null outside the table", () => {
    expect(reworkDanIntervalForStar(1, 0, 4)).toBeNull();
    expect(reworkDanIntervalForStar(99, 0, 4)).toBeNull();
    expect(reworkDanIntervalForStar(9, 0, 6)).toBeNull();
  });

  test("inclusive lower bound, exclusive upper bound", () => {
    const first = reworkDanIntervalForStar(6.5, 0, 4);
    expect(first?.[2]).toContain("Reform 10");
    expect(first?.[2]).toContain("low");
  });
});

describe("reworkDanNextTierName", () => {
  test("names the first tier above the star", () => {
    expect(reworkDanNextTierName(6.4, 0, 4)).toBe("Reform 10");
    expect(reworkDanNextTierName(6.6, 0, 4)).toBe("Alpha");
    expect(reworkDanNextTierName(6.95, 0, 4)).toBe("Beta");
    expect(reworkDanNextTierName(12.5, 0, 4)).toBeNull();
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
