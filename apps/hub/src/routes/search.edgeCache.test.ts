import { beforeAll, describe, expect, test } from "bun:test";

/**
 * F-027: only a fresh index hit may be edge cached. A stale hit, or a row whose
 * refresh is in flight, is no-store so the edge cannot pin the old page list.
 */
describe("searchPageEdgeTtlSec", () => {
  let searchPageEdgeTtlSec: typeof import("./search").searchPageEdgeTtlSec;
  let refreshCacheSingleFlight: typeof import("../services/cache").refreshCacheSingleFlight;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= ":memory:";
    ({ searchPageEdgeTtlSec } = await import("./search"));
    ({ refreshCacheSingleFlight } = await import("../services/cache"));
  });

  test("fresh hit with HTTP cache on gets the edge TTL", () => {
    expect(searchPageEdgeTtlSec("hit-fresh", 1, true, 900)).toBe(900);
  });

  test("stale hit is no-store", () => {
    expect(searchPageEdgeTtlSec("hit-stale", 1, true, 900)).toBeNull();
  });

  test("miss is no-store", () => {
    expect(searchPageEdgeTtlSec("miss", 1, true, 900)).toBeNull();
  });

  test("HTTP cache kill switch forces no-store", () => {
    expect(searchPageEdgeTtlSec("hit-fresh", 1, false, 900)).toBeNull();
  });

  test("fresh hit is no-store while that row is being refreshed", async () => {
    const id = 987_654;
    // The row does not exist, so the refresh rejects asynchronously; the flight
    // is registered synchronously and is observable until it settles.
    const flight = refreshCacheSingleFlight(id).catch(() => undefined);
    expect(refreshCacheSingleFlight.has(id)).toBe(true);
    expect(searchPageEdgeTtlSec("hit-fresh", id, true, 900)).toBeNull();
    await flight;
    expect(refreshCacheSingleFlight.has(id)).toBe(false);
    expect(searchPageEdgeTtlSec("hit-fresh", id, true, 900)).toBe(900);
  });
});
