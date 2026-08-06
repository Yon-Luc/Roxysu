/** Group mappers by osu! user id when present; otherwise by username. */
export function mapperGroupKey(
  mapperOnlineId: number | null | undefined,
  mapperUsername: string | null | undefined,
): string | null {
  const id =
    mapperOnlineId != null && Number.isFinite(Number(mapperOnlineId))
      ? Number(mapperOnlineId)
      : null;
  if (id != null && id > 0) return `id:${id}`;
  const name = mapperUsername?.trim();
  if (!name) return null;
  return `name:${name.toLowerCase()}`;
}

export function mapperOnlineIdFromGroupKey(key: string): number {
  if (key.startsWith("id:")) {
    const id = Number(key.slice(3));
    return Number.isFinite(id) ? id : 0;
  }
  return 0;
}

export type MapperAgg = {
  playCount: number;
  totalPp: number;
  accSum: number;
  usernameCounts: Map<string, number>;
};

export function createMapperAgg(): MapperAgg {
  return { playCount: 0, totalPp: 0, accSum: 0, usernameCounts: new Map() };
}

export function bumpMapperAgg(
  agg: MapperAgg,
  accuracy: number,
  pp: number,
  mapperUsername: string | null | undefined,
): void {
  agg.playCount += 1;
  agg.totalPp += pp;
  agg.accSum += accuracy;
  const name = mapperUsername?.trim();
  if (name) {
    agg.usernameCounts.set(name, (agg.usernameCounts.get(name) ?? 0) + 1);
  }
}

/** Most-played username; ties broken alphabetically for stability. */
export function dominantMapperUsername(
  usernameCounts: Map<string, number>,
): string | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of usernameCounts) {
    if (
      !best ||
      count > best.count ||
      (count === best.count && name.localeCompare(best.name) < 0)
    ) {
      best = { name, count };
    }
  }
  return best?.name ?? null;
}

export function compareMapperAgg(a: MapperAgg, b: MapperAgg): number {
  return (
    b.playCount - a.playCount ||
    b.totalPp - a.totalPp ||
    (dominantMapperUsername(a.usernameCounts) ?? "").localeCompare(
      dominantMapperUsername(b.usernameCounts) ?? "",
    )
  );
}
