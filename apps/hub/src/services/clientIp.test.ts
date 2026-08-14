import { describe, expect, test } from "bun:test";
import { resolveClientIp } from "./clientIp";

describe("resolveClientIp", () => {
  test("ignores forwarded headers when proxy is untrusted", () => {
    expect(
      resolveClientIp({
        trustProxy: false,
        forwardedFor: "1.2.3.4, 10.0.0.1",
        realIp: "9.9.9.9",
        socketIp: "127.0.0.1",
      }),
    ).toBe("127.0.0.1");
  });

  test("does not collapse unidentified clients onto a spoofable header", () => {
    expect(
      resolveClientIp({
        trustProxy: false,
        forwardedFor: "1.2.3.4",
        realIp: null,
        socketIp: null,
      }),
    ).toBe("unidentified");
  });

  test("when trusted, X-Real-Ip wins over X-Forwarded-For", () => {
    expect(
      resolveClientIp({
        trustProxy: true,
        forwardedFor: "1.2.3.4, 10.0.0.1",
        realIp: "10.0.0.9",
        socketIp: "127.0.0.1",
      }),
    ).toBe("10.0.0.9");
  });

  test("when trusted, uses the last X-Forwarded-For hop not the first", () => {
    expect(
      resolveClientIp({
        trustProxy: true,
        forwardedFor: "spoofed, 10.0.0.5",
        realIp: null,
        socketIp: "127.0.0.1",
      }),
    ).toBe("10.0.0.5");
  });

  test("falls back to socket IP when trusted headers are missing", () => {
    expect(
      resolveClientIp({
        trustProxy: true,
        forwardedFor: null,
        realIp: null,
        socketIp: "192.168.1.8",
      }),
    ).toBe("192.168.1.8");
  });
});
