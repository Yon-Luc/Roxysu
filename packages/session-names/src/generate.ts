import terms from "./terms.json";

export type SessionNameTerms = typeof terms;

const MAX_UNIQUE_ATTEMPTS = 64;

const EXTRA_DISTINGUISHERS = [
  "encore",
  "returns",
  "reprise",
  "second wind",
  "once more",
  "after hours",
  "redux",
  "epilogue",
] as const;

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

function mixSeed(sessionId: number, attempt: number): number {
  return (
    (Math.imul(sessionId, 2654435761) ^ Math.imul(attempt + 1, 1597334677)) >>> 0
  );
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function capitalizeSessionName(value: string): string {
  if (value.length === 0) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

type Pattern = {
  build: (rng: () => number, t: SessionNameTerms) => string;
};

/** Three-slot templates only — two-slot names collide too quickly. */
const patterns: Pattern[] = [
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)}'s ${pick(rng, t.modifiers)} ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.modifiers)} ${pick(rng, t.activities)} in ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.modifiers)} ${pick(rng, t.regions)} · ${pick(rng, t.characters)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)}'s ${pick(rng, t.activities)} in ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)} at ${pick(rng, t.regions)} · ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)}'s ${pick(rng, t.styles)} ${pick(rng, t.activities)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.modifiers)} ${pick(rng, t.styles)} in ${pick(rng, t.regions)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.characters)} · ${pick(rng, t.modifiers)} ${pick(rng, t.styles)}`,
  },
  {
    build: (rng, t) =>
      `${pick(rng, t.regions)} ${pick(rng, t.modifiers)} ${pick(rng, t.activities)}`,
  },
];

function buildName(sessionId: number, attempt: number): string {
  const rng = mulberry32(mixSeed(sessionId, attempt));
  const pattern = pick(rng, patterns);
  return capitalizeSessionName(pattern.build(rng, terms));
}

/**
 * Generate a stable display name for a session from its id.
 * Same id + same taken set always yields the same name.
 * When `taken` is provided, retries with a mixed seed until the name is unused.
 */
export function generateSessionName(
  sessionId: number,
  taken: Iterable<string> = [],
): string {
  const used = new Set<string>();
  if (
    taken != null &&
    typeof taken !== "string" &&
    typeof taken !== "number" &&
    typeof (taken as Iterable<string>)[Symbol.iterator] === "function"
  ) {
    for (const name of taken) {
      if (typeof name === "string") used.add(normalizeName(name));
    }
  }

  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt++) {
    const name = buildName(sessionId, attempt);
    if (!used.has(normalizeName(name))) return name;
  }

  const base = buildName(sessionId, MAX_UNIQUE_ATTEMPTS);
  for (const extra of EXTRA_DISTINGUISHERS) {
    const name = capitalizeSessionName(`${base} · ${extra}`);
    if (!used.has(normalizeName(name))) return name;
  }

  return capitalizeSessionName(`${base} · ${sessionId}`);
}

export { terms as sessionNameTerms };
