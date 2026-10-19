import { zipSync, type Zippable } from "fflate";
import { sanitizeZipEntryPath } from "../zipEntryPath";

const STORED = new Set(["png", "jpg", "jpeg", "gif", "mp3", "ogg", "webp"]);

/**
 * Zip fused files into `.osk` bytes. Entry names are re-sanitised, case
 * duplicates are rejected, and an optional plain-text report is added.
 */
export function toOskBytes(
  files: ReadonlyMap<string, Uint8Array>,
  reportText?: string,
): Uint8Array {
  const entries: Zippable = {};
  const seen = new Set<string>();
  const add = (rawPath: string, bytes: Uint8Array) => {
    const safe = sanitizeZipEntryPath(rawPath);
    if (!safe) throw new Error(`Unsafe path in fused skin: ${rawPath}`);
    const lower = safe.toLowerCase();
    if (seen.has(lower)) throw new Error(`Duplicate path in fused skin: ${safe}`);
    seen.add(lower);
    const ext = safe.slice(safe.lastIndexOf(".") + 1).toLowerCase();
    entries[safe] = [bytes, { level: STORED.has(ext) ? 0 : 6 }];
  };
  for (const [path, bytes] of files) add(path, bytes);
  if (reportText) add("fusion-report.txt", new TextEncoder().encode(reportText));
  return zipSync(entries);
}
