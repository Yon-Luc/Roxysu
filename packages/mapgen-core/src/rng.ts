/** Mulberry32 PRNG — deterministic from seed. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted<T extends string>(
  items: Array<{ key: T; weight: number }>,
  rng: () => number,
): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) return items[0]!.key;
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.key;
  }
  return items[items.length - 1]!.key;
}

export function normalizeTargets(
  raw: Record<string, number | undefined>,
): Record<string, number> {
  const entries = Object.entries(raw).filter(([, v]) => v != null && v > 0) as Array<
    [string, number]
  >;
  if (entries.length === 0) {
    return { delay: 1 };
  }
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    out[k] = v / sum;
  }
  return out;
}
