import { describe, expect, test } from "bun:test";
import {
  codeToColumn,
  defaultActionKeybinds,
  defaultKeybindsFor,
  findActionColumnOverlaps,
  findActionKeybindConflicts,
  findKeybindConflicts,
  formatActionCodes,
  formatKeyCode,
  matchesAction,
  parseActionKeybinds,
  resolveKeybinds,
  setActionKeybindSlot,
  getActionKeybinds,
  resetActionKeybinds,
  setActionKeybinds,
  defaultKeybinds,
} from "./keybinds";

describe("keybinds", () => {
  test("defaults have correct length", () => {
    expect(defaultKeybindsFor(4)).toHaveLength(4);
    expect(defaultKeybindsFor(7)).toHaveLength(7);
    expect(defaultKeybindsFor(10)).toHaveLength(10);
  });

  test("codeToColumn finds column", () => {
    const binds = defaultKeybindsFor(4);
    expect(codeToColumn(binds, "KeyD")).toBe(0);
    expect(codeToColumn(binds, "KeyK")).toBe(3);
    expect(codeToColumn(binds, "KeyZ")).toBe(-1);
  });

  test("findKeybindConflicts detects duplicates", () => {
    const binds = ["KeyA", "KeyB", "KeyA", "KeyC"];
    expect(findKeybindConflicts(binds)).toEqual([[0, 2]]);
  });

  test("resolveKeybinds pads unsupported column counts", () => {
    const all = defaultKeybinds();
    const binds = resolveKeybinds(all, 5);
    expect(binds).toHaveLength(5);
  });

  test("formatKeyCode labels common codes", () => {
    expect(formatKeyCode("KeyD")).toBe("D");
    expect(formatKeyCode("Space")).toBe("Space");
    expect(formatKeyCode("Semicolon")).toBe(";");
    expect(formatKeyCode("ArrowLeft")).toBe("←");
    expect(formatKeyCode("Enter")).toBe("Enter");
  });

  test("formatActionCodes joins labels", () => {
    expect(formatActionCodes(["Space", "KeyK"])).toBe("Space / K");
  });
});

describe("action keybinds", () => {
  test("defaults match legacy shortcuts", () => {
    const d = defaultActionKeybinds();
    expect(d.restart).toEqual(["KeyR"]);
    expect(d.playPause).toEqual(["Space", "KeyK"]);
    expect(d.enterPlay).toEqual(["Enter"]);
    expect(d.seekBack).toEqual(["ArrowLeft", "KeyJ"]);
    expect(d.goStart).toEqual(["Home", "Digit0"]);
  });

  test("matchesAction checks codes", () => {
    const d = defaultActionKeybinds();
    expect(matchesAction(d, "restart", "KeyR")).toBe(true);
    expect(matchesAction(d, "restart", "KeyQ")).toBe(false);
    expect(matchesAction(d, "playPause", "Space")).toBe(true);
    expect(matchesAction(d, "playPause", "KeyK")).toBe(true);
  });

  test("findActionKeybindConflicts detects shared codes", () => {
    const binds = defaultActionKeybinds();
    binds.restart = ["KeyF"];
    binds.fullscreen = ["KeyF"];
    const conflicts = findActionKeybindConflicts(binds);
    expect(conflicts.some((g) => g.includes("restart") && g.includes("fullscreen"))).toBe(
      true,
    );
  });

  test("findActionColumnOverlaps detects column collision", () => {
    const actions = defaultActionKeybinds();
    actions.restart = ["KeyD"];
    const cols = defaultKeybindsFor(4);
    expect(findActionColumnOverlaps(actions, cols)).toContain("restart");
  });

  test("parse recovers defaults for bad storage", () => {
    const parsed = parseActionKeybinds(null);
    expect(parsed.restart).toEqual(["KeyR"]);
    const junk = parseActionKeybinds("{not json");
    expect(junk.playPause).toEqual(["Space", "KeyK"]);
    const partial = parseActionKeybinds(
      JSON.stringify({ restart: ["KeyQ"], playPause: "nope" }),
    );
    expect(partial.restart).toEqual(["KeyQ"]);
    expect(partial.playPause).toEqual(["Space", "KeyK"]);
  });

  test("setActionKeybindSlot updates primary and secondary", () => {
    resetActionKeybinds();
    setActionKeybindSlot("restart", 0, "KeyQ");
    expect(getActionKeybinds().restart).toEqual(["KeyQ"]);
    setActionKeybindSlot("restart", 1, "KeyW");
    expect(getActionKeybinds().restart).toEqual(["KeyQ", "KeyW"]);
    setActionKeybindSlot("restart", 1, null);
    expect(getActionKeybinds().restart).toEqual(["KeyQ"]);
    resetActionKeybinds();
  });

  test("setActionKeybinds round-trips", () => {
    const next = defaultActionKeybinds();
    next.stop = ["KeyX"];
    setActionKeybinds(next);
    expect(getActionKeybinds().stop).toEqual(["KeyX"]);
    resetActionKeybinds();
    expect(getActionKeybinds().stop).toEqual(["KeyS"]);
  });
});
