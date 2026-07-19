import { looksLikeQuery } from "./parse";

/**
 * Free-text search → structured overlay query (title/artist/mapper/diff).
 * Structured queries pass through unchanged.
 */
export function toStructuredQuery(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  if (!trimmed) return undefined;
  if (looksLikeQuery(trimmed)) return trimmed;
  return `title:${trimmed} OR artist:${trimmed} OR mapper:${trimmed} OR diff:${trimmed}`;
}
