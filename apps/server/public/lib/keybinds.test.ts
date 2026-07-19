import { describe, expect, test } from "bun:test";
import {
  codeToColumn,
  defaultKeybindsFor,
  findKeybindConflicts,
  formatKeyCode,
  resolveKeybinds,
} from "./keybinds";
import { defaultKeybinds } from "./keybinds";

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
  });
});
