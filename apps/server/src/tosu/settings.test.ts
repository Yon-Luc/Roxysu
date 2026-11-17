import { describe, expect, test } from "bun:test";
import { DEFAULT_TOSU_HOST, normalizeTosuHost } from "./settings";

describe("normalizeTosuHost", () => {
  test("keeps a host and port", () => {
    expect(normalizeTosuHost("127.0.0.1:24050")).toEqual({
      ok: true,
      host: "127.0.0.1:24050",
    });
    expect(normalizeTosuHost("http://tosu.local:24050/")).toEqual({
      ok: true,
      host: "tosu.local:24050",
    });
    expect(normalizeTosuHost("")).toEqual({ ok: true, host: DEFAULT_TOSU_HOST });
  });

  test("rejects a path, userinfo, and whitespace", () => {
    expect(normalizeTosuHost("http://example.com/foo/").ok).toBe(false);
    expect(normalizeTosuHost("user@127.0.0.1:24050").ok).toBe(false);
    expect(normalizeTosuHost("127.0.0.1:24050 extra").ok).toBe(false);
  });
});
