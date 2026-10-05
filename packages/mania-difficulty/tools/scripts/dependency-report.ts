#!/usr/bin/env bun
/**
 * Static dependency report for the pinned mania difficulty calculator.
 * Classifies paths as generate | shim | out-of-scope (Phase 1 deliverable).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const pkgRoot = join(import.meta.dir, "../..");
const config = JSON.parse(
  readFileSync(join(pkgRoot, "tools/upstream.config.json"), "utf8"),
) as {
  generateAllowPrefixes: string[];
  outOfScopePrefixes: string[];
  checkoutDirEnv: string;
  defaultCheckoutRelative: string;
};
const revision = JSON.parse(
  readFileSync(join(pkgRoot, "upstream/revision.json"), "utf8"),
) as { sha: string; branch: string; repository: string };

const upstream =
  process.env[config.checkoutDirEnv] ??
  (existsSync(join(pkgRoot, config.defaultCheckoutRelative, "osu.Game"))
    ? join(pkgRoot, config.defaultCheckoutRelative)
    : existsSync("/tmp/opencode/osu-mania-difficulty/osu.Game")
      ? "/tmp/opencode/osu-mania-difficulty"
      : null);

if (!upstream) {
  console.error("Upstream checkout not found. Run: bun run upstream:pin");
  process.exit(1);
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith(".cs")) acc.push(p);
  }
  return acc;
}

function rel(p: string): string {
  return relative(upstream!, p).replaceAll("\\", "/");
}

function classify(path: string): "generate" | "shim" | "out-of-scope" | "ignore" {
  if (config.outOfScopePrefixes.some((p) => path.startsWith(p))) return "out-of-scope";
  if (
    path.includes("/Drawables/") ||
    path.includes("Performance") ||
    path.includes("LegacyScoreSimulator")
  ) {
    return "out-of-scope";
  }
  if (config.generateAllowPrefixes.some((p) => path.startsWith(p))) {
    // Performance calculators still under Difficulty/
    if (path.includes("Performance")) return "out-of-scope";
    return "generate";
  }
  // Adjacent mania types needed as shims
  if (
    path.startsWith("osu.Game.Rulesets.Mania/Objects/") ||
    path.startsWith("osu.Game.Rulesets.Mania/Scoring/") ||
    path.startsWith("osu.Game.Rulesets.Mania/Beatmaps/ManiaBeatmap") ||
    path.startsWith("osu.Game.Rulesets.Mania/Mods/ManiaMod")
  ) {
    if (path.includes("/Drawables/")) return "out-of-scope";
    return "shim";
  }
  if (
    path.startsWith("osu.Game/Rulesets/Mods/") ||
    path.startsWith("osu.Game/Rulesets/Objects/") ||
    path.startsWith("osu.Game/Rulesets/Scoring/") ||
    path.startsWith("osu.Game/Beatmaps/") ||
    path.startsWith("osu.Game/Utils/")
  ) {
    return "shim";
  }
  return "ignore";
}

const seeds = [
  ...walk(join(upstream, "osu.Game.Rulesets.Mania/Difficulty")),
  ...walk(join(upstream, "osu.Game/Rulesets/Difficulty")),
  ...walk(join(upstream, "osu.Game.Rulesets.Mania/Objects")),
  ...walk(join(upstream, "osu.Game.Rulesets.Mania/Scoring")),
  ...walk(join(upstream, "osu.Game.Rulesets.Mania/Beatmaps")).filter((p) =>
    /ManiaBeatmap\.cs$|ManiaBeatmapConverter\.cs$|StageDefinition\.cs$/.test(p),
  ),
  ...walk(join(upstream, "osu.Game.Rulesets.Mania/Mods")).filter((p) =>
    /ManiaMod(DoubleTime|HalfTime|Easy|HardRock|Daycore|Nightcore)\.cs$/.test(p),
  ),
];

const buckets: Record<string, string[]> = {
  generate: [],
  shim: [],
  "out-of-scope": [],
  ignore: [],
};

for (const p of seeds) {
  const r = rel(p);
  buckets[classify(r)].push(r);
}

for (const k of Object.keys(buckets)) {
  buckets[k].sort();
}

const lines: string[] = [];
lines.push("# Mania difficulty dependency report");
lines.push("");
lines.push(`- **Upstream:** ${revision.repository}`);
lines.push(`- **Branch:** ${revision.branch}`);
lines.push(`- **SHA:** \`${revision.sha}\``);
lines.push(
  `- **Checkout:** \`MANIA_DIFFICULTY_UPSTREAM\` or \`.cache/upstream\` (via \`bun run upstream:pin\`)`,
);
lines.push(`- **Report command:** \`bun run port:report\``);
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push("| Class | Count | Action |");
lines.push("|---|---|---|");
lines.push(
  `| generate | ${buckets.generate.length} | Roslyn → \`generated/\` |`,
);
lines.push(
  `| shim | ${buckets.shim.length} | Handwritten \`src/adapters/\` + minimal types |`,
);
lines.push(
  `| out-of-scope | ${buckets["out-of-scope"].length} | Skip (PP, drawables, legacy) |`,
);
lines.push("");
lines.push("## Entry point");
lines.push("");
lines.push(
  "- `osu.Game.Rulesets.Mania.Difficulty.ManiaDifficultyCalculator`",
);
lines.push("- Skills: Speed, Technical, Jack, Coordination, Release, Total×2");
lines.push(
  "- Attributes: `ManiaDifficultyAttributes` (starRating, skill difficulties, LN ratio, hit window, score-loss coeffs, …)",
);
lines.push("");
lines.push("## v1 scope");
lines.push("");
lines.push("- Difficulty (SR + attributes) only — **no** performance/PP.");
lines.push("- Native mania beatmaps; converts deferred.");
lines.push("- Mods: NM + rate (DT/HT/NC/DC) + EZ/HR hit-window scaling.");
lines.push("");
lines.push("## generate");
lines.push("");
for (const p of buckets.generate) lines.push(`- \`${p}\``);
lines.push("");
lines.push("## shim (handwritten / adapters)");
lines.push("");
for (const p of buckets.shim) lines.push(`- \`${p}\``);
lines.push("");
lines.push("## out-of-scope");
lines.push("");
for (const p of buckets["out-of-scope"]) lines.push(`- \`${p}\``);
lines.push("");
lines.push("## Construct notes (Phase 3+)");
lines.push("");
lines.push(
  "| Construct | Prevalence | Strategy |",
);
lines.push("|---|---|---|");
lines.push("| arithmetic / Math | high | direct |");
lines.push("| LINQ (Min/Max/Sum/Any/…) | medium | emit or shim helpers |");
lines.push("| List/arrays | high | number[] / Array |");
lines.push("| structs (value copy) | low–med | clone helpers |");
lines.push("| ref/out | polynomial utils | fail or rewrite |");
lines.push("| osu.Framework.Precision | polynomial | `src/adapters/math.ts` |");
lines.push("| full beatmap decoder | N/A | `@roxysu/osu-chart` → ManiaBeatmapInput |");
lines.push("");

const outDir = join(pkgRoot, "docs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "dependency-report.md");
writeFileSync(outPath, lines.join("\n") + "\n");
console.error(`[report] wrote ${outPath}`);
console.error(
  `[report] generate=${buckets.generate.length} shim=${buckets.shim.length} out-of-scope=${buckets["out-of-scope"].length}`,
);
