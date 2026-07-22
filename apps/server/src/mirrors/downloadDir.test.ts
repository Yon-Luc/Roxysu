import { describe, expect, test } from "bun:test";
import {
  beatmapSetArchiveFilename,
  resolveBeatmapsDownloadDir,
} from "./downloadDir";

describe("resolveBeatmapsDownloadDir", () => {
  test("defaults to Downloads/beatmaps under home", () => {
    expect(
      resolveBeatmapsDownloadDir({}, () => "/home/user"),
    ).toBe("/home/user/Downloads/beatmaps");
  });

  test("honors BEATMAPS_DOWNLOAD_DIR", () => {
    expect(
      resolveBeatmapsDownloadDir(
        { BEATMAPS_DOWNLOAD_DIR: "/tmp/maps" },
        () => "/home/user",
      ),
    ).toBe("/tmp/maps");
  });

  test("honors XDG_DOWNLOAD_DIR", () => {
    expect(
      resolveBeatmapsDownloadDir(
        { XDG_DOWNLOAD_DIR: "/home/user/dl" },
        () => "/home/user",
      ),
    ).toBe("/home/user/dl/beatmaps");
  });
});

describe("beatmapSetArchiveFilename", () => {
  test("includes set id and sanitizes path chars", () => {
    expect(
      beatmapSetArchiveFilename({
        id: 42,
        artist: "a/b",
        title: 'cool:map?*',
      }),
    ).toBe("42 a_b - cool_map__.osz");
  });
});
