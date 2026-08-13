import terms from "./terms.json";

export type SessionNameTerms = typeof terms;

/** Deterministic mulberry32 PRNG seeded by session id. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function capitalizeSessionName(value: string): string {
  if (value.length === 0) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}

type Pattern = {
  build: (rng: () => number, t: SessionNameTerms) => string;
};

const patterns: Pattern[] = [
  {
    build: (rng, t) => `${pick(rng, t.characters)}'s ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) => `${pick(rng, t.characters)} · ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.modifiers)} ${pick(rng, t.activities)} in ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) => `${pick(rng, t.characters)} at ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)}'s ${pick(rng, t.modifiers)} ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) => `${pick(rng, t.regions)} ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.modifiers)} ${pick(rng, t.regions)} · ${pick(rng, t.characters)}`,
  },
];

/**
 * Generate a stable display name for a session from its id.
 * Same id always yields the same name (used for insert and backfill).
 */
export function generateSessionName(sessionId: number): string {
  const rng = mulberry32(sessionId);
  const pattern = pick(rng, patterns);
  return capitalizeSessionName(pattern.build(rng, terms));
}

export { terms as sessionNameTerms };
