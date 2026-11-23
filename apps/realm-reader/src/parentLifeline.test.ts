import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { attachParentLifeline } from "./parentLifeline";

function fakeStdin(isTTY = false) {
  const em = new EventEmitter() as EventEmitter & { isTTY?: boolean; resumed: boolean; resume(): void };
  em.isTTY = isTTY;
  em.resumed = false;
  em.resume = () => {
    em.resumed = true;
  };
  return em;
}

describe("attachParentLifeline", () => {
  test("does nothing without ROXYSU_PARENT_LIFELINE=1", () => {
    const stdin = fakeStdin();
    let calls = 0;
    expect(attachParentLifeline(() => calls++, { env: {}, stdin })).toBe(false);
    stdin.emit("end");
    expect(calls).toBe(0);
    expect(stdin.resumed).toBe(false);
  });

  test("ignores an interactive terminal", () => {
    const stdin = fakeStdin(true);
    expect(attachParentLifeline(() => {}, { env: { ROXYSU_PARENT_LIFELINE: "1" }, stdin })).toBe(false);
  });

  test("fires once on EOF, close or error", () => {
    const stdin = fakeStdin();
    const reasons: string[] = [];
    expect(
      attachParentLifeline((r) => reasons.push(r), { env: { ROXYSU_PARENT_LIFELINE: "1" }, stdin }),
    ).toBe(true);
    expect(stdin.resumed).toBe(true);
    stdin.emit("end");
    stdin.emit("close");
    stdin.emit("error", new Error("EPIPE"));
    expect(reasons).toEqual(["parent-exit"]);
  });
});
