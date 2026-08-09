/** Format owned/total as "X/Y owned maps". */
export function formatOwnedMapsLabel(owned: number, total: number): string {
  return `${owned.toLocaleString()}/${total.toLocaleString()} owned maps`;
}

export function ownedCountForSets(
  setIds: number[] | undefined,
  ownedIds: ReadonlySet<number> | undefined,
): { owned: number; total: number } | null {
  if (!setIds || !ownedIds) return null;
  const unique = [...new Set(setIds.filter((id) => id > 0))];
  let owned = 0;
  for (const id of unique) {
    if (ownedIds.has(id)) owned += 1;
  }
  return { owned, total: unique.length };
}
