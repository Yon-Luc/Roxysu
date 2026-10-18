import { describe, expect, test } from "bun:test";
import {
  animationFrameNameCandidates,
  animationSingleNameCandidates,
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
