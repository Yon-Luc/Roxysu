/**
 * Zip entry path sanitizer shared by the skin archive writer
 * (`routes/skins.ts`) and the client importers (`public/lib/maniaSkinImport.ts`).
 * Pure: no Node or DOM imports, so it bundles into the client.
 */

/**
 * Normalize a zip entry name to a safe relative path with `/` separators, or
 * return `null` when the entry must be skipped.
 *
 * Rejected (returns `null`):
 * - NUL bytes anywhere in the name
 * - absolute paths (leading `/` or `\`)
 * - drive prefixes (`C:`, `c:\`, `C:foo`)
 * - any `..` segment, including backslash-separated (`..\x`)
 * - names that normalize to nothing (empty, `.`, `/`, `./`)
 *
 * Accepted names are normalized: `\` becomes `/`, `.` segments and empty
 * segments (`a//b`, trailing `/`) are dropped.
 */
export function sanitizeZipEntryPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.includes("\0")) return null;

  const unified = raw.replace(/\\/g, "/");
  if (unified.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(unified)) return null;

  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return segments.join("/");
}
