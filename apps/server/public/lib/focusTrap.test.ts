import { describe, expect, test } from "bun:test";
import { focusTrapTarget } from "./focusTrap";

describe("focusTrapTarget", () => {
  const items = ["input", "a", "b"];

  test("Tab on the last element wraps to the first", () => {
    expect(focusTrapTarget(items, "b", false)).toBe("input");
  });

  test("Shift+Tab on the first element wraps to the last", () => {
    expect(focusTrapTarget(items, "input", true)).toBe("b");
  });

  test("moves inside the dialog are left to the browser", () => {
    expect(focusTrapTarget(items, "input", false)).toBeNull();
    expect(focusTrapTarget(items, "a", false)).toBeNull();
    expect(focusTrapTarget(items, "b", true)).toBeNull();
  });

  test("focus outside the dialog is pulled back in", () => {
    expect(focusTrapTarget(items, null, false)).toBe("input");
    expect(focusTrapTarget(items, "outside", true)).toBe("b");
  });

  test("a dialog without focusable elements yields no target", () => {
    expect(focusTrapTarget([], null, false)).toBeNull();
  });

  test("a single element traps in both directions", () => {
    expect(focusTrapTarget(["only"], "only", false)).toBe("only");
    expect(focusTrapTarget(["only"], "only", true)).toBe("only");
  });
});
