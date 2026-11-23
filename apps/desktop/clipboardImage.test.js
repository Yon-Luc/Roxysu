import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MAX_CLIPBOARD_IMAGE_BYTES, toImageBuffer } = require("./clipboardImage.js");

describe("toImageBuffer", () => {
  test("Buffer round-trip returns the same instance and the same bytes", () => {
    const src = Buffer.from([1, 2, 3, 4]);
    const out = toImageBuffer(src);
    expect(out).toBe(src);
    expect(out.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  test("Uint8Array view wraps only the view's bytes", () => {
    const backing = new Uint8Array([10, 20, 30, 40, 50]);
    const view = new Uint8Array(backing.buffer, 1, 3);
    const out = toImageBuffer(view);
    expect([...out]).toEqual([20, 30, 40]);
    expect(out.buffer).toBe(view.buffer);
    expect(out.byteOffset).toBe(view.byteOffset);
    expect(out.byteLength).toBe(3);
    view[0] = 99;
    expect(out[0]).toBe(99);
  });

  test("ArrayBuffer within cap is wrapped without copying", () => {
    const ab = new ArrayBuffer(4);
    new Uint8Array(ab).set([7, 8, 9, 10]);
    const out = toImageBuffer(ab);
    expect([...out]).toEqual([7, 8, 9, 10]);
    expect(out.buffer).toBe(ab);
    new Uint8Array(ab)[0] = 1;
    expect(out[0]).toBe(1);
  });

  test("a 1-byte Uint8Array succeeds", () => {
    const src = new Uint8Array([42]);
    const out = toImageBuffer(src);
    expect([...out]).toEqual([42]);
    expect(out.buffer).toBe(src.buffer);
  });

  test("empty Buffer throws", () => {
    expect(() => toImageBuffer(Buffer.alloc(0))).toThrow("Invalid image");
  });

  test("oversize Buffer, ArrayBuffer, and Uint8Array throw", () => {
    const huge = new ArrayBuffer(MAX_CLIPBOARD_IMAGE_BYTES + 1);
    const view = new Uint8Array(huge);
    const buf = Buffer.from(huge);
    expect(buf.buffer).toBe(huge);
    expect(() => toImageBuffer(buf)).toThrow("Invalid image");
    expect(() => toImageBuffer(huge)).toThrow("Invalid image");
    expect(() => toImageBuffer(view)).toThrow("Invalid image");
  });

  test("a Uint8Array of length MAX+1 throws before a second copy", () => {
    const over = new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1);
    over[0] = 1;
    expect(() => toImageBuffer(over)).toThrow("Invalid image");
  });

  test("an array-like is rejected and is not turned into a buffer", () => {
    let reads = 0;
    const spy = {
      get length() {
        reads += 1;
        return 20_000_000;
      },
      0: 1,
    };
    expect(() => toImageBuffer({ length: 20_000_000, 0: 1 })).toThrow("Invalid image");
    expect(() => toImageBuffer(spy)).toThrow("Invalid image");
    expect(reads).toBe(0);
  });

  test("null, strings, numbers, and other typed arrays throw", () => {
    expect(() => toImageBuffer(null)).toThrow("Invalid image");
    expect(() => toImageBuffer(undefined)).toThrow("Invalid image");
    expect(() => toImageBuffer("png")).toThrow("Invalid image");
    expect(() => toImageBuffer(12)).toThrow("Invalid image");
    expect(() => toImageBuffer(new Uint16Array([1, 2]))).toThrow("Invalid image");
    expect(() => toImageBuffer(new Int8Array([1, 2]))).toThrow("Invalid image");
    expect(() => toImageBuffer(new Float64Array([1]))).toThrow("Invalid image");
    expect(() => toImageBuffer(new DataView(new ArrayBuffer(4)))).toThrow("Invalid image");
  });

  test("a non-positive maxBytes throws before the bytes are read", () => {
    let reads = 0;
    const spy = {
      get length() {
        reads += 1;
        return 1;
      },
      get byteLength() {
        reads += 1;
        return 1;
      },
    };
    expect(() => toImageBuffer(spy, 0)).toThrow("Invalid image");
    expect(() => toImageBuffer(spy, Number.NaN)).toThrow("Invalid image");
    expect(() => toImageBuffer(spy, Infinity)).toThrow("Invalid image");
    expect(() => toImageBuffer(Buffer.from([1]), 0.5)).toThrow("Invalid image");
    expect(reads).toBe(0);
  });
});
