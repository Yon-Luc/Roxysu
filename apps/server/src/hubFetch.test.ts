import { describe, expect, test } from "bun:test";
import { HubTimeoutError, hubFetch, readHubJson } from "./hubFetch";

describe("hubFetch", () => {
  test("rejects when the server accepts and never responds", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Promise(() => {});
      },
    });
    try {
      await expect(
        hubFetch("/slow", {}, 80, `http://127.0.0.1:${server.port}`),
      ).rejects.toBeInstanceOf(HubTimeoutError);
    } finally {
      await server.stop(true);
    }
  });
});

describe("readHubJson", () => {
  test("parses JSON and rejects an oversized body", async () => {
    expect(await readHubJson(new Response('{"ok":true}'))).toEqual({ ok: true });
    await expect(readHubJson(new Response("123456"), 3)).rejects.toThrow(/too large/);
  });
});
