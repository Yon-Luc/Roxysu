import { describe, expect, test } from "bun:test";
import {
  collageGrid,
  encodePcmWav,
  mixTracksToWav,
  partitionByKeyCount,
  sanitizeMarathonFilename,
} from "./marathonExport";

describe("collageGrid", () => {
  test("tiles into a near-square grid", () => {
    expect(collageGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(collageGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(collageGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(collageGrid(5)).toEqual({ cols: 3, rows: 2 });
    expect(collageGrid(9)).toEqual({ cols: 3, rows: 3 });
  });
});

describe("sanitizeMarathonFilename", () => {
  test("adds .osz and strips hostile characters", () => {
    expect(sanitizeMarathonFilename("A / B")).toBe("A _ B.osz");
    expect(sanitizeMarathonFilename("already.osz")).toBe("already.osz");
  });
});

describe("encodePcmWav", () => {
  test("writes a valid WAV header", () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([0, -0.5, 0.5]);
    const wav = encodePcmWav([left, right], 44100);
    expect(wav.byteLength).toBe(44 + 3 * 2 * 2);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
  });
});

describe("mixTracksToWav", () => {
  const RATE = 44100;
  const constant = (frames: number, value: number): [Float32Array, Float32Array] => [
    new Float32Array(frames).fill(value),
    new Float32Array(frames).fill(-value),
  ];
  const sampleAt = (wav: Uint8Array, frame: number, channel: 0 | 1): number =>
    new DataView(wav.buffer, wav.byteOffset).getInt16(44 + frame * 4 + channel * 2, true);

  test("places tracks, silence and durations at exact frame offsets", async () => {
    const tracks = [constant(1000, 0.5), constant(2000, 0.25)];
    const pauseMs = 100;
    const pauseFrames = Math.round((pauseMs / 1000) * RATE);
    const { wav, durationsMs } = await mixTracksToWav({
      count: 2,
      pauseMs,
      loadTrack: async (i) => tracks[i]!,
    });
    const total = 1000 + pauseFrames + 2000;
    expect(wav.byteLength).toBe(44 + total * 4);
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(total * 4);
    expect(new DataView(wav.buffer).getUint32(4, true)).toBe(36 + total * 4);
    expect(durationsMs).toEqual([
      Math.round((1000 / RATE) * 1000),
      Math.round((2000 / RATE) * 1000),
    ]);
    expect(sampleAt(wav, 0, 0)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(sampleAt(wav, 999, 1)).toBe(Math.trunc(-0.5 * 0x8000));
    expect(sampleAt(wav, 1000, 0)).toBe(0);
    expect(sampleAt(wav, 1000 + pauseFrames - 1, 1)).toBe(0);
    expect(sampleAt(wav, 1000 + pauseFrames, 0)).toBe(Math.trunc(0.25 * 0x7fff));
    expect(sampleAt(wav, total - 1, 1)).toBe(Math.trunc(-0.25 * 0x8000));
  });

  test("matches encodePcmWav for a single track", async () => {
    const [l, r] = constant(64, 0.3);
    const { wav } = await mixTracksToWav({
      count: 1,
      pauseMs: 0,
      loadTrack: async () => [l, r],
    });
    expect(wav).toEqual(encodePcmWav([l, r], RATE));
  });

  test("loads tracks one at a time", async () => {
    let live = 0;
    let maxLive = 0;
    await mixTracksToWav({
      count: 3,
      pauseMs: 0,
      loadTrack: async () => {
        live += 1;
        maxLive = Math.max(maxLive, live);
        await Promise.resolve();
        live -= 1;
        return constant(10, 0.5);
      },
    });
    expect(maxLive).toBe(1);
  });

  test("rejects a marathon over the duration cap", async () => {
    await expect(
      mixTracksToWav({
        count: 2,
        pauseMs: 0,
        maxDurationSec: 1,
        loadTrack: async () => constant(RATE, 0.5),
      }),
    ).rejects.toThrow(/limit/);
  });

  test("rejects silent audio", async () => {
    await expect(
      mixTracksToWav({
        count: 2,
        pauseMs: 0,
        loadTrack: async () => constant(10, 0),
      }),
    ).rejects.toThrow(/silent/);
  });

  test("stops between tracks when aborted", async () => {
    const ctrl = new AbortController();
    let loads = 0;
    const run = mixTracksToWav({
      count: 3,
      pauseMs: 0,
      signal: ctrl.signal,
      loadTrack: async () => {
        loads += 1;
        ctrl.abort();
        return constant(10, 0.5);
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(loads).toBe(1);
  });
});

describe("partitionByKeyCount", () => {
  const k = (keyCount: number | null, id = "x") => ({ id, keyCount });

  test("rejects an add that differs from the first existing track", () => {
    const r = partitionByKeyCount([k(4), k(4)], [k(4, "a"), k(7, "b")]);
    expect(r.referenceKeyCount).toBe(4);
    expect(r.accepted.map((s) => s.id)).toEqual(["a"]);
    expect(r.rejected.map((s) => s.id)).toEqual(["b"]);
  });

  test("uses the first incoming source when the list is empty", () => {
    const r = partitionByKeyCount([], [k(7, "a"), k(4, "b"), k(7, "c")]);
    expect(r.referenceKeyCount).toBe(7);
    expect(r.accepted.map((s) => s.id)).toEqual(["a", "c"]);
    expect(r.rejected.map((s) => s.id)).toEqual(["b"]);
  });

  test("accepts everything when no key count is known", () => {
    const r = partitionByKeyCount([], [k(null, "a")]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
});
