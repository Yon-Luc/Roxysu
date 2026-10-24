import { afterEach, describe, expect, test } from "bun:test";
import { startPlayfieldRaf } from "./playfieldRaf";

describe("startPlayfieldRaf", () => {
  const timers: ReturnType<typeof setInterval>[] = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;

  afterEach(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    for (const t of timers) realClearInterval(t);
    timers.length = 0;
  });

  test("does not start a heartbeat interval by default", () => {
    let intervalCalls = 0;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      intervalCalls += 1;
      const id = realSetInterval(...args);
      timers.push(id);
      return id;
    }) as typeof setInterval;

    const loop = startPlayfieldRaf({
      getTimeMs: () => 0,
      snapshot: () => [0],
      paint: () => {},
    });
    expect(intervalCalls).toBe(0);
    loop.stop();
  });

  test("starts and clears heartbeat when heartbeatHz is set", () => {
    let intervalCalls = 0;
    let cleared = 0;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      intervalCalls += 1;
      const id = realSetInterval(...args);
      timers.push(id);
      return id;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      cleared += 1;
      return realClearInterval(id);
    }) as typeof clearInterval;

    const loop = startPlayfieldRaf({
      getTimeMs: () => 0,
      snapshot: () => [0],
      paint: () => {},
      heartbeatHz: 30,
    });
    expect(intervalCalls).toBe(1);
    loop.stop();
    expect(cleared).toBeGreaterThanOrEqual(1);
  });
});
