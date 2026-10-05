#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DiffUtils, SQRT2, calculateManiaDifficulty } from "../../src/index";

const pkgRoot = join(import.meta.dir, "../..");
const manifestPath = join(pkgRoot, "generated/manifest.json");

if (!existsSync(manifestPath)) {
  console.error("missing generated/manifest.json — run port:generate");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  upstreamSha: string;
  files: Array<{ path: string }>;
};
const revision = JSON.parse(
  readFileSync(join(pkgRoot, "upstream/revision.json"), "utf8"),
) as { sha: string };

if (manifest.upstreamSha !== revision.sha) {
  console.error(
    `manifest sha ${manifest.upstreamSha} != revision ${revision.sha}`,
  );
  process.exit(1);
}

// DiffUtils smoke (generated)
const s = DiffUtils.Smoothstep(0.5, 0, 1);
if (!(s > 0.4 && s < 0.6)) {
  console.error("Smoothstep unexpected", s);
  process.exit(1);
}
if (Math.abs(SQRT2 - Math.SQRT2) > 1e-12) {
  console.error("SQRT2 mismatch", SQRT2);
  process.exit(1);
}
if (Math.abs(DiffUtils.Pow(2, 3) - 8) > 1e-12) {
  console.error("Pow failed", DiffUtils.Pow(2, 3));
  process.exit(1);
}

const empty = calculateManiaDifficulty({
  columnCount: 4,
  overallDifficulty: 8,
  notes: [],
});
if (empty.starRating !== 0) {
  console.error("empty map should be 0*", empty);
  process.exit(1);
}

const sparse = calculateManiaDifficulty({
  columnCount: 4,
  overallDifficulty: 8,
  notes: [
    { column: 0, startMs: 0, endMs: 0 },
    { column: 1, startMs: 500, endMs: 0 },
    { column: 2, startMs: 1000, endMs: 0 },
  ],
});
if (!(sparse.starRating! > 0) || !(sparse.speedDifficulty! > 0)) {
  console.error("sparse map should have speed SR", sparse);
  process.exit(1);
}

console.error("[verify] smoke ok");
console.log(
  JSON.stringify({
    ok: true,
    files: manifest.files.length,
    sparseStar: sparse.starRating,
    skills: {
      speed: sparse.speedDifficulty,
      tech: sparse.technicalDifficulty,
      jack: sparse.jackDifficulty,
      coord: sparse.coordinationDifficulty,
      release: sparse.releaseDifficulty,
    },
  }),
);
