import { describe, expect, test } from "bun:test";
import {
  danVariantKey,
  resolveDanVariant,
} from "./mods";

function modsJson(...entries: Array<string | Record<string, unknown>>): string {
  return JSON.stringify(
    entries.map((e) => (typeof e === "string" ? { acronym: e } : e)),
  );
}

describe("resolveDanVariant", () => {
  test("NM / Mirror / Classic are NM-equivalent", () => {
    expect(resolveDanVariant(null)).toBeNull();
    expect(resolveDanVariant("[]")).toBeNull();
    expect(resolveDanVariant(modsJson("MR"))).toBeNull();
    expect(resolveDanVariant(modsJson("CL"))).toBeNull();
    expect(resolveDanVariant(modsJson("MR", "CL"))).toBeNull();
  });

  test("DT/NC default to 1.5, HT/DC to 0.75", () => {
    expect(resolveDanVariant(modsJson("DT"))).toEqual({
      rate: 1.5,
      lnOnly: false,
    });
    expect(resolveDanVariant(modsJson("NC"))).toEqual({
      rate: 1.5,
      lnOnly: false,
    });
    expect(resolveDanVariant(modsJson("HT"))).toEqual({
      rate: 0.75,
      lnOnly: false,
    });
    expect(resolveDanVariant(modsJson("DC"))).toEqual({
      rate: 0.75,
      lnOnly: false,
    });
  });

  test("custom speed_change is recovered and quantized", () => {
    expect(resolveDanVariant(modsJson("DT"))).toBeTruthy();
    const custom = resolveDanVariant(
      modsJson({ acronym: "DT", settings: { speed_change: 1.1 } }),
    );
    expect(custom).toEqual({ rate: 1.1, lnOnly: false });

    const messy = resolveDanVariant(
      modsJson({ acronym: "HT", settings: { speed_change: 1.099999 } }),
    );
    expect(messy?.rate).toBe(1.1);
  });

  test("Invert marks full-LN conversion; combined with rate mods", () => {
    expect(resolveDanVariant(modsJson("IN"))).toEqual({
      rate: 1,
      lnOnly: true,
    });
    expect(resolveDanVariant(modsJson("IN", "MR"))).toEqual({
      rate: 1,
      lnOnly: true,
    });
    expect(
      resolveDanVariant(
        modsJson("IN", { acronym: "DT", settings: { speed_change: 1.25 } }),
      ),
    ).toEqual({ rate: 1.25, lnOnly: true });
  });
});

describe("danVariantKey", () => {
  test("distinguishes beatmap, rate, and LN flag", () => {
    const a = danVariantKey("map1", { rate: 1.1, lnOnly: false });
    expect(a).toBe(danVariantKey("map1", { rate: 1.1, lnOnly: false }));
    expect(a).not.toBe(danVariantKey("map2", { rate: 1.1, lnOnly: false }));
    expect(a).not.toBe(danVariantKey("map1", { rate: 1.5, lnOnly: false }));
    expect(a).not.toBe(danVariantKey("map1", { rate: 1.1, lnOnly: true }));
  });
});
