import { createReadStream, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  getOsuDataPath,
  isLazerFileHash,
  resolveLazerFilePath,
} from "./lazer-files";

export type ServeHashedFileResult =
  | { ok: true; file: ReadableStream<Uint8Array>; contentType: string }
  | { ok: false; status: 400 | 404 | 415; error: string };

/**
 * Validate a lazer file hash, resolve path, check existence, sniff MIME.
 * Caller sets response headers (cache-control, accept-ranges, etc.).
 */
export async function serveHashedFile(
  rawHash: string,
  sniffMime: (bytes: Uint8Array) => string | null,
  notFoundError: string,
  wrongTypeError: string,
): Promise<ServeHashedFileResult> {
  const hash = rawHash.toLowerCase();
  if (!isLazerFileHash(hash)) {
    return { ok: false, status: 400, error: "Invalid file hash" };
  }

  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
  if (!filePath) {
    return { ok: false, status: 400, error: "Invalid file hash" };
  }

  if (!existsSync(filePath)) {
    return { ok: false, status: 404, error: notFoundError };
  }

  const handle = await open(filePath, "r");
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    const type = sniffMime(new Uint8Array(head.buffer, head.byteOffset, bytesRead));
    if (!type) {
      return { ok: false, status: 415, error: wrongTypeError };
    }

    const nodeStream = createReadStream(filePath);
    const file = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return { ok: true, file, contentType: type };
  } finally {
    await handle.close();
  }
}
