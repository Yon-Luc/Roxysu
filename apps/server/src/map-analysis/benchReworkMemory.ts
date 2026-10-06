/**
 * Resident-memory growth check for the backfill inner loop.
 *
 * Rates a generated library one map at a time and samples RSS after each map.
 * `sync` reproduces the old behaviour (a tight synchronous loop, which starved
 * the collector and grew until the OS OOM-killed the process); `async` is the
 * job's yielding loop. Same workload, same calculator — only the yield differs.
 *
 * Run with: bun run bench:mem
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beatmapSets, beatmaps, closeDb, ensureDb } from "@roxysu/db/client.bun";
import { computeReworkDanSync } from "./computeReworkDan";
import { yieldForBackfill } from "./jobYield";
import type { Db } from "@roxysu/db/types";

const MAP_COUNT = Number(process.env.BENCH_MAPS ?? 150);
const NOTES = Number(process.env.BENCH_NOTES ?? 2500);
const KEYS = Number(process.env.BENCH_KEYS ?? 7);
const MODE = (process.env.BENCH_MODE ?? "async") as "async" | "sync";

function rssMb(): number {
  return process.memoryUsage.rss() / 1024 / 1024;
}

function collect(): void {
  if (typeof Bun !== "undefined" && typeof Bun.gc === "function") Bun.gc(true);
}

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
    `Title: mem ${seed}`,
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
      lines.push(
        `${((col + 1) * 512) / keyCount},192,${t},128,0,${t + 70 * len}:0:0:0:0:`,
      );
      col = (col + 1 + Math.floor(rnd() * (keyCount - 1))) % keyCount;
      t += 70 * len;
      written++;
    } else {
      lines.push(`${((col + 1) * 512) / keyCount},192,${t},1,0,0:0:0:0:`);
      col = Math.max(
        0,
        Math.min(keyCount - 1, col + (rnd() < 0.5 ? -1 : 1)),
      );
      t += 70 + (rnd() < 0.1 ? 35 : 0);
      written++;
    }
  }
  return lines.join("\n");
}

const tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-mem-"));
const osuDir = path.join(tmpDir, "osu");
let db: Db = null as unknown as Db;

const hashes: string[] = [];

function seed(): void {
  db = ensureDb(path.join(tmpDir, "mem.sqlite"));
  db.insert(beatmapSets)
    .values({ id: "set", onlineId: 1, dateAdded: new Date(), status: 2 })
    .run();
  for (let i = 0; i < MAP_COUNT; i++) {
    const hash = i.toString(16).padStart(64, "a");
    hashes.push(hash);
    const filePath = path.join(
      osuDir,
      "files",
      hash[0]!,
      hash.slice(0, 2),
      hash,
    );
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, osuText(NOTES, KEYS, i + 1));
    db.insert(beatmaps)
      .values({
        id: `map-${i}`,
        setId: "set",
        onlineId: 1000 + i,
        hash,
        status: 2,
        length: 180,
        bpm: 200,
        starRating: 5,
        rulesetShortName: "mania",
        circleSize: KEYS,
      })
      .run();
  }
  process.env.OSU_DATA_PATH = osuDir;
}

seed();

// Warm up the JIT, then reset so the measured run starts from the same state.
for (let i = 0; i < 3; i++) {
  computeReworkDanSync(db, "map-0", hashes[0]!, { withPattern: true });
}
db.$client.query(`DELETE FROM beatmap_dan_ratings`).run();
db.$client.query(`DELETE FROM beatmap_pattern_analysis`).run();
collect();

const baseline = rssMb();
console.log(
  `mode=${MODE}  ${MAP_COUNT} maps x ${NOTES} notes (${KEYS}K)  baseline RSS=${baseline.toFixed(0)}MB\n`,
);
console.log("   map    RSS(MB)   growth(MB)");

const yieldState = { count: 0 };
const samples: number[] = [];
const started = performance.now();

for (let i = 0; i < MAP_COUNT; i++) {
  computeReworkDanSync(db, `map-${i}`, hashes[i]!, { withPattern: true });
  if (MODE === "async") await yieldForBackfill(yieldState);
  samples.push(rssMb());
}

const elapsed = performance.now() - started;
const peak = samples.reduce((m, s) => Math.max(m, s), baseline);

for (let i = 0; i < samples.length; i++) {
  const n = i + 1;
  if (n <= 10 || n % 25 === 0 || n === samples.length) {
    console.log(
      `  ${String(n).padStart(4)}   ${samples[i]!.toFixed(0).padStart(7)}   ${(samples[i]! - baseline).toFixed(0).padStart(9)}`,
    );
  }
}

console.log(
  `\n${MODE}: elapsed=${(elapsed / 1000).toFixed(1)}s  ` +
    `peak RSS=${peak.toFixed(0)}MB  growth=${(peak - baseline).toFixed(0)}MB  ` +
    `end=${(samples[samples.length - 1]! - baseline).toFixed(0)}MB`,
);

try {
  closeDb(db);
} catch {
  // ignore
}
rmSync(tmpDir, { recursive: true, force: true });
delete process.env.OSU_DATA_PATH;