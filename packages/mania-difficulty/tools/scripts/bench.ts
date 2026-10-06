/**
 * Phase-level benchmark for the mania difficulty port.
 *
 * Run with: bun run bench
 *
 * Generates synthetic charts at realistic note counts and times each stage so
 * optimization effort targets the real hotspot. Does not assert anything — this
 * is a measurement tool, not a test.
 */

import { buildHitObjectGraph } from "../../src/adapters/hitObject";
import { calculateWithSkills } from "../../src/skills/calculator";
import type { ManiaBeatmapInput } from "../../src/types";

type Tier = { notes: number; keys: number; gapMs: number };

const TIERS: Tier[] = [
  { notes: 500, keys: 7, gapMs: 60 },
  { notes: 2000, keys: 7, gapMs: 70 },
  { notes: 8000, keys: 7, gapMs: 75 },
  { notes: 2000, keys: 4, gapMs: 120 },
  { notes: 8000, keys: 4, gapMs: 140 },
];

/** Deterministic PRNG so runs are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a chart with mixed content: single-note runs, chords and holds, so the
 * pattern preprocessor and hold-aware evaluators both get exercised.
 */
function synth({ notes, keys, gapMs }: Tier): ManiaBeatmapInput {
  const rnd = mulberry32(notes * 31 + keys);
  const out: ManiaBeatmapInput["notes"] = [];
  let t = 1000;
  let col = 0;
  while (out.length < notes) {
    const roll = rnd();
    if (roll < 0.12 && keys > 2) {
      // chord of 2–3 columns
      const size = 2 + (rnd() < 0.3 ? 1 : 0);
      const width = Math.min(size, keys);
      const start = Math.floor(rnd() * (keys - width + 1));
      for (let i = 0; i < width && out.length < notes; i++) {
        out.push({ column: start + i, startMs: t, endMs: t });
      }
      t += gapMs;
    } else if (roll < 0.2) {
      // hold note
      const len = 2 + Math.floor(rnd() * 12);
      out.push({ column: col, startMs: t, endMs: t + gapMs * len });
      col = (col + 1 + Math.floor(rnd() * (keys - 1))) % keys;
      t += gapMs * len;
    } else {
      out.push({ column: col, startMs: t, endMs: t });
      col = Math.max(0, Math.min(keys - 1, col + (rnd() < 0.5 ? -1 : 1) + (rnd() < 0.12 ? 2 : 0)));
      t += gapMs + (rnd() < 0.1 ? Math.round(gapMs * 0.5) : 0);
    }
  }
  return { columnCount: keys, overallDifficulty: 8, notes: out };
}

function ms(start: () => void): number {
  const t0 = performance.now();
  start();
  return performance.now() - t0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const REPEATS = 5;

console.log(
  `chart                notes    keys   graph(ms)  calc(ms)  calc+onObj(ms)  graph%`,
);
console.log("-".repeat(84));

for (const tier of TIERS) {
  const beatmap = synth(tier);

  // Warm up so JIT/first-run costs don't dominate the medians.
  buildHitObjectGraph(beatmap.columnCount, beatmap.notes, 1);
  calculateWithSkills(beatmap, { clockRate: 1 });
  calculateWithSkills(beatmap, { clockRate: 1, onObject: () => {} });

  const graphTimes: number[] = [];
  const calcTimes: number[] = [];
  const obsTimes: number[] = [];

  for (let i = 0; i < REPEATS; i++) {
    graphTimes.push(
      ms(() => buildHitObjectGraph(beatmap.columnCount, beatmap.notes, 1)),
    );
    calcTimes.push(ms(() => calculateWithSkills(beatmap, { clockRate: 1 })));
    obsTimes.push(
      ms(() => calculateWithSkills(beatmap, { clockRate: 1, onObject: () => {} })),
    );
  }

  const graph = median(graphTimes);
  const calc = median(calcTimes);
  const obs = median(obsTimes);
  const graphPct = (graph / calc) * 100;

  console.log(
    `synth-${`${tier.keys}k`.padEnd(10)} ` +
      `${String(beatmap.notes.length).padStart(6)}  ` +
      `${String(tier.keys).padStart(5)}  ` +
      `${graph.toFixed(2).padStart(8)}  ` +
      `${calc.toFixed(2).padStart(8)}  ` +
      `${obs.toFixed(2).padStart(13)}  ` +
      `${graphPct.toFixed(1).padStart(6)}`,
  );
}

console.log("\ngraph% = share of full calculation spent in hit-object graph + preprocessor");