import { describe, expect, test } from "bun:test";
import {
  BEATMAP_MIRROR_PROVIDERS,
  DEFAULT_BEATMAP_MIRROR_PROVIDER,
  getActiveBeatmapMirrorProvider,
  isBeatmapMirrorProviderId,
  parsePositiveSetId,
} from "./providers";

describe("parsePositiveSetId", () => {
  test("accepts positive integers", () => {
    expect(parsePositiveSetId("1")).toBe(1);
    expect(parsePositiveSetId("1012634")).toBe(1012634);
  });

  test("rejects invalid ids", () => {
    expect(parsePositiveSetId("0")).toBeNull();
    expect(parsePositiveSetId("-1")).toBeNull();
    expect(parsePositiveSetId("1.5")).toBeNull();
    expect(parsePositiveSetId("abc")).toBeNull();
    expect(parsePositiveSetId("")).toBeNull();
  });
});

describe("beatmap mirror providers", () => {
  test("builds nerinyan urls", () => {
    expect(BEATMAP_MIRROR_PROVIDERS.nerinyan.buildDownloadUrl(42)).toBe(
      "https://api.nerinyan.moe/d/42",
    );
    expect(
      BEATMAP_MIRROR_PROVIDERS.nerinyan.buildDownloadUrl(42, { noVideo: true }),
    ).toBe("https://api.nerinyan.moe/d/42?nv=1");
  });

  test("builds osu.direct urls", () => {
    expect(BEATMAP_MIRROR_PROVIDERS["osu.direct"].buildDownloadUrl(42)).toBe(
      "https://osu.direct/api/d/42",
    );
    expect(
      BEATMAP_MIRROR_PROVIDERS["osu.direct"].buildDownloadUrl(42, {
        noVideo: true,
      }),
    ).toBe("https://osu.direct/api/d/42n");
  });

  test("defaults to nerinyan", () => {
    const prev = process.env.BEATMAP_MIRROR_PROVIDER;
    delete process.env.BEATMAP_MIRROR_PROVIDER;
    expect(getActiveBeatmapMirrorProvider().id).toBe(
      DEFAULT_BEATMAP_MIRROR_PROVIDER,
    );
    process.env.BEATMAP_MIRROR_PROVIDER = "osu.direct";
    expect(getActiveBeatmapMirrorProvider().id).toBe("osu.direct");
    process.env.BEATMAP_MIRROR_PROVIDER = "not-a-mirror";
    expect(getActiveBeatmapMirrorProvider().id).toBe(
      DEFAULT_BEATMAP_MIRROR_PROVIDER,
    );
    if (prev === undefined) delete process.env.BEATMAP_MIRROR_PROVIDER;
    else process.env.BEATMAP_MIRROR_PROVIDER = prev;
  });

  test("validates provider ids", () => {
    expect(isBeatmapMirrorProviderId("nerinyan")).toBe(true);
    expect(isBeatmapMirrorProviderId("osu.direct")).toBe(true);
    expect(isBeatmapMirrorProviderId("chimu")).toBe(false);
  });
});
