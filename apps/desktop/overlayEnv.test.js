import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { overlayEnv } = require("./overlayEnv.js");

describe("overlayEnv", () => {
  test("keeps LD_LIBRARY_PATH when this is not a packaged resources tree", () => {
    const env = { LD_LIBRARY_PATH: "/nix/lib", PATH: "/usr/bin" };
    expect(overlayEnv(env)).toEqual(env);
    expect(env.LD_LIBRARY_PATH).toBe("/nix/lib");
  });

  test("drops the wrapper library path when ROXYSU_RESOURCES is set", () => {
    const next = overlayEnv({
      ROXYSU_RESOURCES: "/nix/store/roxysu/resources",
      LD_LIBRARY_PATH: "/nix/lib/libstdc++",
      PATH: "/usr/bin",
    });
    expect(next.LD_LIBRARY_PATH).toBeUndefined();
    expect(next.PATH).toBe("/usr/bin");
    expect(next.ROXYSU_RESOURCES).toBe("/nix/store/roxysu/resources");
  });

  test("ROXYSU_OVERLAY_LIBRARY_PATH wins over the drop", () => {
    const next = overlayEnv({
      ROXYSU_RESOURCES: "/nix/store/roxysu/resources",
      ROXYSU_OVERLAY_LIBRARY_PATH: " /opt/webkit/lib ",
      LD_LIBRARY_PATH: "/nix/lib",
    });
    expect(next.LD_LIBRARY_PATH).toBe("/opt/webkit/lib");
  });

  test("a blank override does not count", () => {
    const next = overlayEnv({
      ROXYSU_RESOURCES: "/res",
      ROXYSU_OVERLAY_LIBRARY_PATH: "   ",
      LD_LIBRARY_PATH: "/nix/lib",
    });
    expect(next.LD_LIBRARY_PATH).toBeUndefined();
  });
});
