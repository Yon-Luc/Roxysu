import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseOsuChart } from "@roxysu/osu-chart";
import {
  beatmapFromOsuChart,
  calculateManiaDifficulty,
  greatHitWindowForOd,
} from "../../src/index";

const pkgRoot = join(import.meta.dir, "../..");
const sha = "e6207616bd732c7c00207a060f31cf7729f8390b";
const baselineDir = join(pkgRoot, "tests/fixtures/baselines", sha);

type Baseline = {
  version: string;
  starRating: number;
  starRatingSs?: number;
  attributes: Record<string, number>;
};

function loadBaseline(name: string): Baseline {
  return JSON.parse(
    readFileSync(join(baselineDir, `${name}.json`), "utf8"),
  ) as Baseline;
}

function loadBeatmap(name: string) {
  const text = readFileSync(
    join(pkgRoot, "tests/fixtures", `${name}.osu`),
    "utf8",
  );
  const chart = parseOsuChart(text);
  const odMatch = text.match(/OverallDifficulty:\s*([\d.]+)/);
  const od = odMatch ? Number(odMatch[1]) : 8;
  return beatmapFromOsuChart(chart, od);
}

/** Near-parity on fixtures (release on rice maps can be tiny absolute noise). */
const REL_TOL = 0.02;
const ABS_TOL = 0.05;

function closeEnough(actual: number, expected: number, label: string) {
  const err = Math.abs(actual - expected);
  const rel = expected !== 0 ? err / Math.abs(expected) : err;
  const ok = err <= ABS_TOL || rel <= REL_TOL;
  if (!ok) {
    console.error(
      `${label}: actual=${actual} expected=${expected} abs=${err} rel=${rel}`,
    );
  }
  expect(ok).toBe(true);
}

describe("parity vs C# baselines (soft)", () => {
  test("great hit window OD8", () => {
    expect(greatHitWindowForOd(8)).toBeCloseTo(40, 0);
  });

  for (const name of ["synthetic-4k-sparse", "synthetic-7k-dense"] as const) {
    test(name, () => {
      const baseline = loadBaseline(name);
      const beatmap = loadBeatmap(name);
      const result = calculateManiaDifficulty(beatmap);

      expect(result.noteCount).toBe(baseline.attributes.note_count);
      expect(result.holdNoteCount).toBe(baseline.attributes.hold_note_count);

      closeEnough(result.starRating, baseline.starRating, "starRating");
      if (result.starRatingSs != null && baseline.starRatingSs != null) {
        closeEnough(result.starRatingSs, baseline.starRatingSs, "starRatingSs");
      }
      for (const [key, attr] of [
        ["speedDifficulty", "speed_difficulty"],
        ["technicalDifficulty", "technical_difficulty"],
        ["jackDifficulty", "jack_difficulty"],
        ["coordinationDifficulty", "coordination_difficulty"],
      ] as const) {
        const actual = result[key];
        const expected = baseline.attributes[attr];
        if (actual != null && expected != null) {
          closeEnough(actual, expected, key);
        }
      }
      if (
        result.meanManipulation != null &&
        baseline.attributes.mean_manip != null
      ) {
        closeEnough(
          result.meanManipulation,
          baseline.attributes.mean_manip,
          "meanManipulation",
        );
      }
    });
  }
});
