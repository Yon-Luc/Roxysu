/** Cap for one Generate collections request. */
export const COLLECTION_BATCH_MAX = 200;

export type CollectionBatchItem = {
  name: string;
  query: string;
};

/**
 * Drop rows whose name is already stored, and later duplicates in the same
 * request. The first row wins. Does not overwrite.
 */
export function selectNewCollectionRows(
  items: readonly CollectionBatchItem[],
  existingNames: Iterable<string>,
): { insert: CollectionBatchItem[]; skipped: number } {
  const existing = new Set(existingNames);
  const seen = new Set<string>();
  const insert: CollectionBatchItem[] = [];
  let skipped = 0;
  for (const item of items) {
    if (existing.has(item.name) || seen.has(item.name)) {
      skipped += 1;
      continue;
    }
    seen.add(item.name);
    insert.push(item);
  }
  return { insert, skipped };
}
