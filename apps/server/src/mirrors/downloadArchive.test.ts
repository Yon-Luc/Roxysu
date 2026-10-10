import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  downloadBeatmapsetArchiveToPath,
  listDownloadProvidersInOrder,
  MirrorArchiveUnavailableError,
} from "./downloadArchive";

const originalFetch = globalThis.fetch;

function oszResponse(bytes = 128): Response {
  return new Response(new Uint8Array(bytes).fill(1), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listDownloadProvidersInOrder", () => {
  test("puts the requested provider first, then the others", () => {
    const order = listDownloadProvidersInOrder("hinai").map((p) => p.id);
    expect(order[0]).toBe("hinai");
    expect(order.slice(1).sort()).toEqual(["nerinyan", "osu.direct"].sort());
  });
});

describe("downloadBeatmapsetArchiveToPath", () => {
  test("returns exists when the archive is already on disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-dl-"));
    try {
      const dest = path.join(dir, "1.osz");
      writeFileSync(dest, "already-here-and-long-enough");
      const calls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return oszResponse();
      }) as typeof fetch;

      await expect(
        downloadBeatmapsetArchiveToPath(1, dest, true),
      ).resolves.toBe("exists");
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws a friendly unavailable error when every mirror fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-dl-"));
    try {
      const dest = path.join(dir, "99.osz");
      globalThis.fetch = (async () =>
        new Response("nope", { status: 503 })) as typeof fetch;

      let caught: unknown;
      try {
        await downloadBeatmapsetArchiveToPath(99, dest, true);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MirrorArchiveUnavailableError);
      expect((caught as MirrorArchiveUnavailableError).message).toBe(
        "Map #99 is not available for download right now.",
      );
      expect((caught as MirrorArchiveUnavailableError).code).toBe(
        "mirror_unavailable",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to the next mirror when hinai returns 503", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-dl-"));
    try {
      const dest = path.join(dir, "42.osz");
      const calls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("hinamizawa")) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "mirrors temporarily unavailable for this beatmapset, retry",
            }),
            {
              status: 503,
              headers: { "content-type": "application/json", "retry-after": "0" },
            },
          );
        }
        if (url.includes("osu.direct") || url.includes("nerinyan")) {
          return oszResponse(256);
        }
        return new Response("nope", { status: 404 });
      }) as typeof fetch;

      const prev = process.env.BEATMAP_MIRROR_PROVIDER;
      process.env.BEATMAP_MIRROR_PROVIDER = "hinai";
      try {
        await expect(
          downloadBeatmapsetArchiveToPath(42, dest, true),
        ).resolves.toBe("downloaded");
      } finally {
        if (prev === undefined) delete process.env.BEATMAP_MIRROR_PROVIDER;
        else process.env.BEATMAP_MIRROR_PROVIDER = prev;
      }

      expect(calls.some((u) => u.includes("hinamizawa"))).toBe(true);
      expect(
        calls.some((u) => u.includes("osu.direct") || u.includes("nerinyan")),
      ).toBe(true);
      expect(readFileSync(dest).byteLength).toBe(256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
