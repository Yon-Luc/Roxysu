import {
  getOsuDataPath,
  isLazerFileHash,
  resolveLazerFilePath,
} from "./lazer-files";

export type ServeHashedFileResult =
  | { ok: true; file: ReturnType<typeof Bun.file>; contentType: string }
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

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return { ok: false, status: 404, error: notFoundError };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffMime(head);
  if (!type) {
    return { ok: false, status: 415, error: wrongTypeError };
  }

  return { ok: true, file, contentType: type };
}
