import { describe, expect, test } from "bun:test";
import { parseAdminOsuId, resolveHubLoginRole } from "./hubRole";

describe("parseAdminOsuId", () => {
  test("parses a positive integer", () => {
    expect(parseAdminOsuId("12345")).toBe(12345);
  });

  test("rejects empty, zero, and garbage", () => {
    expect(parseAdminOsuId(undefined)).toBeNull();
    expect(parseAdminOsuId("")).toBeNull();
    expect(parseAdminOsuId("  ")).toBeNull();
    expect(parseAdminOsuId("0")).toBeNull();
    expect(parseAdminOsuId("nope")).toBeNull();
  });
});

describe("resolveHubLoginRole", () => {
  test("promotes when osu id matches ADMIN_OSU_ID", () => {
    expect(
      resolveHubLoginRole({ osuId: 9, existingRole: "user", adminOsuId: 9 }),
    ).toBe("admin");
    expect(
      resolveHubLoginRole({ osuId: 9, existingRole: null, adminOsuId: 9 }),
    ).toBe("admin");
  });

  test("does not demote an existing admin when env is unset", () => {
    expect(
      resolveHubLoginRole({
        osuId: 9,
        existingRole: "admin",
        adminOsuId: null,
      }),
    ).toBe("admin");
  });

  test("does not demote an existing admin when ADMIN_OSU_ID is someone else", () => {
    expect(
      resolveHubLoginRole({
        osuId: 9,
        existingRole: "admin",
        adminOsuId: 1,
      }),
    ).toBe("admin");
  });

  test("new and existing users stay user without a match", () => {
    expect(
      resolveHubLoginRole({ osuId: 9, existingRole: null, adminOsuId: 1 }),
    ).toBe("user");
    expect(
      resolveHubLoginRole({ osuId: 9, existingRole: "user", adminOsuId: null }),
    ).toBe("user");
  });
});
