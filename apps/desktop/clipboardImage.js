"use strict";

/** IPC clipboard image cap. Checked before any copy or wrap. */
const MAX_CLIPBOARD_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Accept only Buffer, ArrayBuffer, or Uint8Array. Wrap without copying.
 * Reject array-likes, other typed arrays, strings, numbers, null.
 * Empty or over-cap throws Error("Invalid image") before allocating.
 * @param {unknown} bytes
 * @param {number} [maxBytes]
 * @returns {Buffer}
 */
function toImageBuffer(bytes, maxBytes = MAX_CLIPBOARD_IMAGE_BYTES) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error("Invalid image");
  }

  if (Buffer.isBuffer(bytes)) {
    if (bytes.length === 0 || bytes.length > maxBytes) {
      throw new Error("Invalid image");
    }
    return bytes;
  }

  if (bytes instanceof ArrayBuffer) {
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      throw new Error("Invalid image");
    }
    // Shares the ArrayBuffer. Do not `new Uint8Array` first.
    return Buffer.from(bytes);
  }

  // Uint8Array only. Buffer is a Uint8Array subclass and already returned.
  // Buffer.from(uint8Array) copies; the 3-arg form wraps the view.
  if (bytes instanceof Uint8Array) {
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      throw new Error("Invalid image");
    }
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  throw new Error("Invalid image");
}

module.exports = { MAX_CLIPBOARD_IMAGE_BYTES, toImageBuffer };
