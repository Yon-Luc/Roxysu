import { describe, expect, test } from "bun:test";
import {
  animationFrameNameCandidates,
  animationSingleNameCandidates,
  hitsoundBlobKey,
  hitsoundNameCandidates,
  hitsoundSampleKey,
} from "./stdSkinImport";

describe("slider ball / followpoint name candidates", () => {
  test("prefers stable sliderbN over sliderball", () => {
    const names = animationFrameNameCandidates("sliderball", 0);
    expect(names[0]).toBe("sliderb0");
    expect(names).toContain("sliderb-0");
    expect(names.indexOf("sliderb0")).toBeLessThan(
      names.indexOf("sliderball0"),
    );
  });

  test("single-frame slider ball prefers sliderb", () => {
    expect(animationSingleNameCandidates("sliderball")).toEqual([
      "sliderb",
      "sliderball",
    ]);
  });

  test("followpoint frames use hyphenated stable names first", () => {
    expect(animationFrameNameCandidates("followpoint", 0)[0]).toBe(
      "followpoint-0",
    );
    expect(animationSingleNameCandidates("followpoint")).toEqual([
      "followpoint",
    ]);
  });
});

describe("hitsound sample naming", () => {
  test("index 0/1 uses bare set-hit key", () => {
    expect(hitsoundSampleKey("soft", "hitclap", 0)).toBe("soft-hitclap");
    expect(hitsoundSampleKey("soft", "hitclap", 1)).toBe("soft-hitclap");
    expect(hitsoundSampleKey("soft", "hitclap", 2)).toBe("soft-hitclap2");
  });

  test("name candidates include bare slidertick for normal", () => {
    expect(hitsoundNameCandidates("normal", "slidertick", 0)).toEqual([
      "normal-slidertick",
      "slidertick",
    ]);
    expect(hitsoundNameCandidates("drum", "hitnormal", 0)).toEqual([
      "drum-hitnormal",
    ]);
    expect(hitsoundBlobKey("normal-hitnormal")).toBe("std:hs:normal-hitnormal");
  });
});
