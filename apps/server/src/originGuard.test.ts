import { describe, expect, test } from "bun:test";
import { mutationOriginAllowed } from "./originGuard";

const loopback = {
  listenHostname: "127.0.0.1",
  listenPort: 4321,
};

describe("mutationOriginAllowed", () => {
  test("ignores safe methods", () => {
    expect(
      mutationOriginAllowed({
        method: "GET",
        origin: "https://example.com",
        ...loopback,
        peerAddress: "8.8.8.8",
      }),
    ).toBe(true);
  });

  test("allows the UI origins and a loopback peer with no Origin", () => {
    expect(
      mutationOriginAllowed({
        method: "PATCH",
        origin: "http://127.0.0.1:4321",
        ...loopback,
        peerAddress: null,
      }),
    ).toBe(true);
    expect(
      mutationOriginAllowed({
        method: "POST",
        origin: "http://localhost:4321",
        ...loopback,
        peerAddress: null,
      }),
    ).toBe(true);
    expect(
      mutationOriginAllowed({
        method: "POST",
        origin: null,
        ...loopback,
        peerAddress: null,
      }),
    ).toBe(true);
    expect(
      mutationOriginAllowed({
        method: "POST",
        origin: null,
        listenHostname: "0.0.0.0",
        listenPort: 4321,
        peerAddress: "127.0.0.1",
      }),
    ).toBe(true);
  });

  test("rejects a foreign origin and a non-loopback peer with no Origin", () => {
    expect(
      mutationOriginAllowed({
        method: "PATCH",
        origin: "https://example.com",
        ...loopback,
        peerAddress: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      mutationOriginAllowed({
        method: "POST",
        origin: "http://rebind.example:4321",
        ...loopback,
        peerAddress: "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      mutationOriginAllowed({
        method: "POST",
        origin: null,
        listenHostname: "0.0.0.0",
        listenPort: 4321,
        peerAddress: "192.168.1.20",
      }),
    ).toBe(false);
    expect(
      mutationOriginAllowed({
        method: "DELETE",
        origin: null,
        listenHostname: "0.0.0.0",
        listenPort: 4321,
        peerAddress: null,
      }),
    ).toBe(false);
  });
});
