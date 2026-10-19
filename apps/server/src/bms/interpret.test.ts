import { describe, expect, test } from "bun:test";
import {
  gaugeIdFromAcronyms,
  gradeMeets,
  interpretBmsScore,
  isAllowedBmsTableUrl,
  isKnownVariantId,
  parseBmsTableJson,
  variantIdFromAcronyms,
} from "@roxysu/db/bms";

const SAMPLE_MODS = JSON.stringify([
  { acronym: "HS" },
  { acronym: "CN" },
  { acronym: "C1" },
  { acronym: "L1" },
]);
const SAMPLE_STATS = JSON.stringify({
  perfect: 1413,
  great: 495,
  good: 14,
  ok: 5,
  meh: 3,
  miss: 11,
});
const SAMPLE_MAX = JSON.stringify({ perfect: 1930 });

describe("interpretBmsScore", () => {
  test("matches EX and accuracy from a local Realm score", () => {
    const row = interpretBmsScore({
      statistics: SAMPLE_STATS,
      maximumStatistics: SAMPLE_MAX,
      mods: SAMPLE_MODS,
      totalScore: 860363,
      accuracy: 3321 / 3860,
    });
    expect(row.exScore).toBe(1413 * 2 + 495);
    expect(row.maxExScore).toBe(1930 * 2);
    expect(row.exScore! / row.maxExScore!).toBeCloseTo(row.accuracy, 12);
    expect(row.normalizedScore).toBe(860363);
    expect(row.judgements).toMatchObject({
      pgreat: 1413,
      great: 495,
      good: 14,
      bad: 5,
      poor: 3,
      miss: 11,
      ePoor: null,
    });
    expect(row.variantId).toBe("CN+HS+L1");
    expect(row.gaugeId).toBe("class");
    expect(row.comboLampId).toBeNull();
    expect(row.clearLampId).toBeNull();
    expect(row.djGrade).toBe("aa");
    expect(row.autoplay).toBe(false);
  });

  test("keeps Scratch, No Scratch, Constant, and 2P in different variants", () => {
    expect(variantIdFromAcronyms([])).toBe("standard");
    expect(variantIdFromAcronyms(["HS"])).toBe("HS");
    expect(variantIdFromAcronyms(["CN", "2P"])).toBe("2P+CN");
    expect(variantIdFromAcronyms(["CN", "2P", "AS"])).toBe("2P+AS+CN");
    expect(variantIdFromAcronyms(["HS", "CN", "L1"])).not.toBe(
      variantIdFromAcronyms(["2P"]),
    );
    expect(isKnownVariantId("CN+HS+L1")).toBe(true);
    expect(isKnownVariantId("HS+CN")).toBe(false);
    expect(isKnownVariantId("NOPE")).toBe(false);
  });

  test("leaves gauge null when no gauge mod is stored", () => {
    expect(gaugeIdFromAcronyms(["2P"])).toBeNull();
    expect(gaugeIdFromAcronyms(["HS", "CN"])).toBeNull();
    expect(gaugeIdFromAcronyms(["AG", "HS"])).toBe("normal");
    expect(gaugeIdFromAcronyms(["AG", "H1"])).toBe("hard");
  });

  test("marks autoplay and does not invent judgements", () => {
    const row = interpretBmsScore({
      statistics: null,
      maximumStatistics: null,
      mods: JSON.stringify([{ acronym: "AT" }]),
      totalScore: 0,
      accuracy: 0,
    });
    expect(row.autoplay).toBe(true);
    expect(row.exScore).toBeNull();
    expect(row.judgements.pgreat).toBeNull();
    expect(row.comboLampId).toBeNull();
    expect(row.clearLampId).toBeNull();
  });

  test("combo lamps come only from judgement counts", () => {
    const base = {
      maximumStatistics: JSON.stringify({ perfect: 10 }),
      mods: "[]",
      totalScore: 1_000_000,
      accuracy: 1,
    };
    expect(
      interpretBmsScore({
        ...base,
        statistics: JSON.stringify({ perfect: 10, great: 0, good: 0, ok: 0, meh: 0, miss: 0 }),
      }).comboLampId,
    ).toBe("max");
    expect(
      interpretBmsScore({
        ...base,
        accuracy: 0.9,
        statistics: JSON.stringify({ perfect: 8, great: 2, good: 0, ok: 0, meh: 0, miss: 0 }),
      }).comboLampId,
    ).toBe("perfect");
    expect(
      interpretBmsScore({
        ...base,
        accuracy: 0.8,
        statistics: JSON.stringify({ perfect: 7, great: 1, good: 2, ok: 0, meh: 0, miss: 0 }),
      }).comboLampId,
    ).toBe("fc");
    expect(
      interpretBmsScore({
        ...base,
        statistics: JSON.stringify({ perfect: 10, great: 0, good: 0, ok: 0, meh: 0 }),
      }).comboLampId,
    ).toBeNull();
    expect(
      interpretBmsScore({
        ...base,
        statistics: JSON.stringify({ perfect: 10, great: 0, good: 0, miss: 0 }),
      }).comboLampId,
    ).toBeNull();
  });

  test("grade thresholds are cumulative", () => {
    expect(gradeMeets("max", "aaa")).toBe(true);
    expect(gradeMeets("aa", "aaa")).toBe(false);
    expect(gradeMeets(null, "aa")).toBe(false);
  });
});

describe("parseBmsTableJson", () => {
  test("parses a header plus chart array and drops unresolved hashes", () => {
    const parsed = parseBmsTableJson(
      JSON.stringify({
        name: "Satellite",
        symbol: "sl",
        data_url: "data.json",
        level_order: ["1", "2"],
        charts: [
          { level: "1", md5: "A".repeat(32), title: "One", artist: "A" },
          { level: "2", md5: "nope", sha256: "b".repeat(64), title: "Two" },
          { level: "2", md5: "short" },
        ],
      }),
      "table",
    );
    expect(parsed?.name).toBe("Satellite");
    expect(parsed?.entries).toHaveLength(2);
    expect(parsed?.entries[0]?.md5).toBe("a".repeat(32));
    expect(parsed?.entries[1]?.sha256).toBe("b".repeat(64));
    expect(parsed?.unresolvedCount).toBe(1);
  });

  test("allows only https hosts on the table allowlist", () => {
    expect(isAllowedBmsTableUrl("https://stellabms.xyz/sl/table.html")).toBe(true);
    expect(isAllowedBmsTableUrl("http://stellabms.xyz/sl/table.html")).toBe(false);
    expect(isAllowedBmsTableUrl("https://127.0.0.1/table.json")).toBe(false);
    expect(isAllowedBmsTableUrl("https://evil.example/table.json")).toBe(false);
    expect(isAllowedBmsTableUrl("https://user:pass@stellabms.xyz/a")).toBe(false);
  });
});
