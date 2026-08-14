import { describe, expect, test } from "bun:test";
import { hubStatusClearsJwt } from "../../lib/hub";

describe("hubStatusClearsJwt", () => {
  test("clears only when a Bearer token got a 401", () => {
    expect(hubStatusClearsJwt(401, true)).toBe(true);
    expect(hubStatusClearsJwt(401, false)).toBe(false);
    expect(hubStatusClearsJwt(403, true)).toBe(false);
    expect(hubStatusClearsJwt(200, true)).toBe(false);
  });
});
