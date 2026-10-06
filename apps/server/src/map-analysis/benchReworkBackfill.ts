/**
 * End-to-end backfill benchmark.
 *
 * Times `backfillReworkDanSync` over a generated library of synthetic charts in a
 * throwaway SQLite file, so the number includes parsing, the calculator, and
 * SQLite writes. Run with: bun run bench:backfill
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beatmapSets, beatmaps, closeDb, ensureDb } from "@roxysu/db/client.bun";
import { REWORK_ALGORITHM, backfillReworkDanSync } from "./computeReworkDan";
import type { Db } from "@roxysu/db/types";

const MAP_COUNT = Number(process.env.BENCH_MAPS ?? 120);
const NOTES = Number(process.env.BENCH_NOTES ?? 1500);
const KEYS = Number(process.env.BENCH_KEYS ?? 7);

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function osuText(notes: number, keyCount: number, seed: number): string {
  const rnd = mulberry32(seed);
  const lines = [
    "osu file format v14",
    "[General]",
    "Mode: 3",
    "[Metadata]",
    `Title: bench ${seed}`,
    "Artist: bench",
    "Version: bench",
    "[Difficulty]",
    `CircleSize: ${keyCount}`,
    "OverallDifficulty: 8",
    "[TimingPoints]",
    "0,300,4,2,0,60,1,0",
    "[HitObjects]",
  ];
  let t = 1000;
  let col = 0;
  let written = 0;
  while (written < notes) {
    const r = rnd();
    if (r < 0.12 && keyCount > 2) {
      const w = 2 + (rnd() < 0.3 ? 1 : 0);
      const start = Math.floor(rnd() * (keyCount - w + 1));
      for (let i = 0; i < w && written < notes; i++) {
        lines.push(`${((start + i + 1) * 512) / keyCount},192,${t},1,0,0:0:0:0:`);
        written++;
      }
      t += 70;
    } else if (r < 0.2) {
      const len = 2 + Math.floor(rnd() * 10);
      lines.push(`${((col + 1) * 512) / keyCount},192,${t},128,0,${t + 70 * len}:0:0:0:0:`);
      col = (col + 1 + Math.floor(rnd() * (keyCount - 1))) % keyCount;
      t += 70 * len;
      written++;
    } else {
      lines.push(`${((col + 1) * 512) / keyCount},192,${t},1,0,0:0:0:0:`);
      col = Math.max(0, Math.min(keyCount - 1, col + (rnd() < 0.5 ? -1 : 1)));
      t += 70 + (rnd() < 0.1 ? 35 : 0);
      written++;
    }
  }
  return lines.join("\n");
}

const tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bench-backfill-"));
const osuDir = path.join(tmpDir, "osu");
let db: Db = null as unknown as Db;

function seed(): void {
  db = ensureDb(path.join(tmpDir, "bench.sqlite"));
  db.insert(beatmapSets)
    .values({ id: "set", onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();

  for (let i = 0; i < MAP_COUNT; i++) {
    // 64 hex chars (SHA-256), unique per map — matches real lazer file hashes.
    const hash = i.toString(16).padStart(64, "a");
    const filePath = path.join(osuDir, "files", hash[0]!, hash.slice(0, 2), hash);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, osuText(NOTES, KEYS, i + 1));

    db.insert(beatmaps)
      .values({
        id: `map-${i}`,
        setId: "set",
        onlineId: 1000 + i,
        hash,
        status: 2,
        length: 120,
        bpm: 200,
        starRating: 5,
        rulesetShortName: "mania",
        circleSize: KEYS,
      })
      .run();
  }
  process.env.OSU_DATA_PATH = osuDir;
}

function reset(): void {
  db.$client.query(`DELETE FROM beatmap_dan_ratings`).run();
  db.$client.query(`DELETE FROM beatmap_pattern_analysis`).run();
}

function run(label: string, withPattern: boolean): number {
  reset();
  const started = performance.now();
  let attempted = 0;
  let succeeded = 0;
  for (;;) {
    const batch = backfillReworkDanSync(db, {
      limit: 200,
      includeFailed: false,
      skipRelabel: true,
      withPattern,
    });
    attempted += batch.attempted;
    succeeded += batch.succeeded;
    if (batch.attempted === 0) break;
  }
  const elapsed = performance.now() - started;
  const perMap = elapsed / Math.max(1, attempted);
  console.log(
    `${label.padEnd(28)} ${elapsed.toFixed(0).padStart(6)}ms  ` +
      `${perMap.toFixed(1).padStart(6)}ms/map  ` +
      `(${succeeded}/${attempted} rated)`,
  );
  return elapsed;
}

console.log(
  `library: ${MAP_COUNT} maps x ${NOTES} notes (${KEYS}K)\n`,
);

seed();

// Warm up so JIT costs do not land on the measured run.
run("warmup (dan only)", false);
run("warmup (dan + pattern)", true);

const danOnly = run("dan rows only", false);
const fused = run("dan + pattern (fused)", true);

console.log(
  `\nfused pass is ${(danOnly / fused).toFixed(2)}x the cost of a dan-only pass ` +
    `(it fills both stores)`,
);

const rated = db.$client
  .query(
    `SELECT COUNT(*) AS n FROM beatmap_dan_ratings WHERE algorithm = ? AND est_diff IS NOT NULL`,
  )
  .get(REWORK_ALGORITHM) as { n: number };
console.log(`rows persisted: ${Number(rated.n)}`);

try {
  closeDb(db);
} catch {
  // ignore
}
rmSync(tmpDir, { recursive: true, force: true });
delete process.env.OSU_DATA_PATH;