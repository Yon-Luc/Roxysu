import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import {
  MAX_SSE_CLIENTS,
  acquireSseSlot,
  activeSseClientCount,
  sseRoutes,
} from "./sse";

describe("SSE subscriber cap", () => {
  test("refuses past the cap and releases idempotently", () => {
    const before = activeSseClientCount();
    const a = acquireSseSlot(2);
    const b = acquireSseSlot(2);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(acquireSseSlot(2)).toBeNull();

    a!.release();
    a!.release(); // must not double-decrement
    expect(activeSseClientCount()).toBe(before + 1);

    const c = acquireSseSlot(2);
    expect(c).not.toBeNull();
    b!.release();
    c!.release();
    expect(activeSseClientCount()).toBe(before);
  });

  test("/api/events answers 429 when full", async () => {
    const before = activeSseClientCount();
    const held = Array.from({ length: MAX_SSE_CLIENTS }, () =>
      acquireSseSlot(MAX_SSE_CLIENTS),
    );
    expect(held.every((slot) => slot != null)).toBe(true);
    try {
      const app = new Elysia().use(sseRoutes);
      const res = await app.handle(new Request("http://localhost/api/events"));
      expect(res.status).toBe(429);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as {
        error: string;
        maxSubscribers: number;
      };
      expect(body.maxSubscribers).toBe(MAX_SSE_CLIENTS);
      expect(body.error).toContain("Too many");
    } finally {
      for (const slot of held) slot?.release();
    }
    expect(activeSseClientCount()).toBe(before);
  });
});
