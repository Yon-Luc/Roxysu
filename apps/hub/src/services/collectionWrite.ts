/** Dedupe tags (first occurrence wins). Empty / whitespace skipped. */
export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Dedupe beatmapset IDs (first occurrence wins); keep aligned map names. */
export function uniqueBeatmapsetIds(
  ids: number[],
  mapNames?: string[],
): { beatmapsetIds: number[]; mapNames: string[] } {
  const seen = new Set<number>();
  const beatmapsetIds: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    beatmapsetIds.push(id);
    names.push(mapNames?.[i] ?? "");
  }
  return { beatmapsetIds, mapNames: names };
}
