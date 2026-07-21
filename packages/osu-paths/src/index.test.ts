import { describe, expect, test } from "bun:test";
import path from "node:path";
import { platformDefaultOsuDataPath } from "./index";

describe("platformDefaultOsuDataPath", () => {
  test("uses APPDATA on Windows", () => {
    expect(
      platformDefaultOsuDataPath("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, () =>
        "C:\\Users\\me",
      ),
    ).toBe(path.join("C:\\Users\\me\\AppData\\Roaming", "osu"));
  });

  test("falls back to homedir AppData\\Roaming on Windows when APPDATA unset", () => {
    expect(platformDefaultOsuDataPath("win32", {}, () => "C:\\Users\\me")).toBe(
      path.join("C:\\Users\\me", "AppData", "Roaming", "osu"),
    );
  });

  test("uses Application Support on macOS", () => {
    expect(platformDefaultOsuDataPath("darwin", {}, () => "/Users/me")).toBe(
      path.join("/Users/me", "Library", "Application Support", "osu"),
    );
  });

  test("uses .local/share on Linux", () => {
    expect(platformDefaultOsuDataPath("linux", {}, () => "/home/me")).toBe(
      path.join("/home/me", ".local", "share", "osu"),
    );
  });
});
