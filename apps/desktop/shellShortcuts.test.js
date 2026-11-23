import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { shortcutFor } = require("./shellShortcuts.js");

const down = (key, mods = {}) => ({ type: "keyDown", key, ...mods });

describe("shortcutFor (DD-9)", () => {
  test.each([
    [down("=", { control: true }), "zoom-in"],
    [down("+", { control: true }), "zoom-in"],
    [down("-", { control: true }), "zoom-out"],
    [down("0", { control: true }), "zoom-reset"],
    [down("0", { meta: true }), "zoom-reset"],
    [down("r", { control: true }), "reload"],
    [down("R", { control: true }), "reload"],
    [down("F5"), "reload"],
    [down("F11"), "fullscreen"],
  ])("%o → %s", (input, expected) => {
    expect(shortcutFor(input)).toBe(expected);
  });

  test("plain typing and the app's own Ctrl+K are left alone", () => {
    expect(shortcutFor(down("r"))).toBeNull();
    expect(shortcutFor(down("0"))).toBeNull();
    expect(shortcutFor(down("k", { control: true }))).toBeNull();
    expect(shortcutFor(down("=", { control: true, alt: true }))).toBeNull();
  });

  test("key-up is ignored", () => {
    expect(shortcutFor({ type: "keyUp", key: "F5" })).toBeNull();
  });

  test("F12 only when dev tools are allowed", () => {
    expect(shortcutFor(down("F12"))).toBeNull();
    expect(shortcutFor(down("F12"), { allowDevTools: true })).toBe("devtools");
  });
});
