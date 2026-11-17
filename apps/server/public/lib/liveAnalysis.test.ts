import { describe, expect, test } from "bun:test";
import {
  liveAnalysisMatches,
  selectLivePatternDetail,
} from "./liveAnalysis";

describe("selectLivePatternDetail", () => {
  test("returns the detail only when the checksum matches", () => {
    const detail = { samples: [1] };
    expect(
      selectLivePatternDetail({ checksum: "a", detail }, "a"),
    ).toEqual(detail);
  });

  test("returns null when the payload belongs to another map or is empty", () => {
    expect(
      selectLivePatternDetail({ checksum: "b", detail: { samples: [1] } }, "a"),
    ).toBeNull();
    expect(
      selectLivePatternDetail({ checksum: null, detail: null }, "a"),
    ).toBeNull();
    expect(selectLivePatternDetail(undefined, "a")).toBeNull();
    expect(liveAnalysisMatches({ checksum: "a" }, null)).toBe(false);
  });
});
