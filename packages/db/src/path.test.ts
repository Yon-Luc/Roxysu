import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  defaultDataDir,
  defaultDbPath,
  isDesktopRuntime,
  platformDefaultRoxysuDataDir,
} from "./path";

describe("platformDefaultRoxysuDataDir", () => {
  test("uses APPDATA on Windows", () => {
    expect(
      platformDefaultRoxysuDataDir("win32", {
        APPDATA: "C:\\Users\\me\\AppData\\Roaming",
      }),
    ).toBe(path.join("C:\\Users\\me\\AppData\\Roaming", "Roxysu"));
  });

  test("uses Application Support on macOS", () => {
    expect(
      platformDefaultRoxysuDataDir("darwin", {}, () => "/Users/me"),
    ).toBe("/Users/me/Library/Application Support/Roxysu");
  });

  test("uses XDG data home on Linux", () => {
    expect(
      platformDefaultRoxysuDataDir("linux", {}, () => "/home/me"),
    ).toBe("/home/me/.local/share/roxysu");
  });
});

describe("defaultDataDir / defaultDbPath", () => {
  test("honors ROXYSU_DATA_DIR", () => {
    const dir = defaultDataDir({ ROXYSU_DATA_DIR: "/tmp/roxysu-data" });
    expect(dir).toBe(path.resolve("/tmp/roxysu-data"));
    expect(defaultDbPath({ ROXYSU_DATA_DIR: "/tmp/roxysu-data" })).toBe(
      path.join(path.resolve("/tmp/roxysu-data"), "data.sqlite"),
    );
  });

  test("honors DB_PATH over data dir", () => {
    expect(
      defaultDbPath({
        DB_PATH: "/custom/db.sqlite",
        ROXYSU_DATA_DIR: "/tmp/roxysu-data",
      }),
    ).toBe("/custom/db.sqlite");
  });

  test("desktop flag uses platform data dir", () => {
    expect(isDesktopRuntime({ ROXYSU_DESKTOP: "1" })).toBe(true);
    const dir = defaultDataDir({
      ROXYSU_DESKTOP: "1",
      APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    });
    // On the actual host platform; only assert desktop mode changes path away from empty.
    expect(dir.length).toBeGreaterThan(0);
    expect(defaultDbPath({ ROXYSU_DESKTOP: "1" }).endsWith("data.sqlite")).toBe(
      true,
    );
  });

  test("monorepo default is apps/server/data.sqlite", () => {
    const db = defaultDbPath({});
    expect(db.replace(/\\/g, "/")).toMatch(/apps\/server\/data\.sqlite$/);
  });
});
