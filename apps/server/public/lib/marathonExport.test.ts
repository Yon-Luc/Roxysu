import { describe, expect, test } from "bun:test";
import {
  collageGrid,
  encodePcmWav,
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
