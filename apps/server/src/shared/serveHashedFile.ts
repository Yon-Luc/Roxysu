import { createReadStream, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  getOsuDataPath,
  isLazerFileHash,
  resolveLazerFilePath,
} from "./lazer-files";

export type ServeHashedFileResult =
  | {
      ok: true;
      file: ReadableStream<Uint8Array>;
      contentType: string;
      /** Total file size in bytes. */
      size: number;
      /** Inclusive byte offsets of the returned body. */
      start: number;
      end: number;
      partial: boolean;
    }
  | {
      ok: false;
      status: 400 | 404 | 415 | 416;
      error: string;
      /** Present for 416 so callers can set Content-Range. */
      size?: number;
    };

/**
 * Parse a single HTTP Range bytes=… spec.
 * Returns null when absent/unusable (serve full file), or "unsatisfiable".
 */
export function parseBytesRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bytes=")) return null;
  // Only honor a single range (browsers send one for media seek).
  const spec = trimmed.slice(6).split(",", 1)[0]!.trim();
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return null;

  if (size <= 0) return "unsatisfiable";

  if (m[1] === "" && m[2] !== "") {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = m[1] === "" ? 0 : Number(m[1]);
  let end = m[2] === "" ? size - 1 : Number(m[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return null;
  if (start >= size) return "unsatisfiable";
  end = Math.min(end, size - 1);
  if (start > end) return "unsatisfiable";
  return { start, end };
}

/**
 * Validate a lazer file hash, resolve path, check existence, sniff MIME.
 * Optionally honor a Range header so audio/video can seek.
 * Caller sets response headers (cache-control, content-range, etc.).
 */
export async function serveHashedFile(
  rawHash: string,
  sniffMime: (bytes: Uint8Array) => string | null,
  notFoundError: string,
  wrongTypeError: string,
  rangeHeader?: string | null,
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
    const type = sniffMime(
      new Uint8Array(head.buffer, head.byteOffset, bytesRead),
    );
    if (!type) {
      return { ok: false, status: 415, error: wrongTypeError };
    }

    const { size } = await handle.stat();
    const range = parseBytesRange(rangeHeader, size);
    if (range === "unsatisfiable") {
      return {
        ok: false,
        status: 416,
        error: "Range Not Satisfiable",
        size,
      };
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, size - 1);
    const nodeStream =
      size === 0
        ? Readable.from([])
        : createReadStream(filePath, { start, end });
    const file = Readable.toWeb(
      nodeStream,
    ) as unknown as ReadableStream<Uint8Array>;
    return {
      ok: true,
      file,
      contentType: type,
      size,
      start,
      end,
      partial: range != null,
    };
  } finally {
    await handle.close();
  }
}
