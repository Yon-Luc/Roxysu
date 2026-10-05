#!/usr/bin/env bun
/**
 * Ensures the transpiler fails loudly on unsupported constructs (Phase 3 acceptance).
 * Writes a tiny C# snippet with `out` params and expects ERROR diagnostics.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";

const pkgRoot = join(import.meta.dir, "../..");
const probeRoot = mkdtempSync(join(tmpdir(), "mania-diff-probe-"));
const csDir = join(probeRoot, "osu.Game/Rulesets/Difficulty/Utils");
mkdirSync(csDir, { recursive: true });

writeFileSync(
  join(csDir, "DiffUtils.cs"),
  `namespace osu.Game.Rulesets.Difficulty.Utils {
  public static class DiffUtils {
    public static void Bad(out int x) { x = 1; }
  }
}
`,
);

const prev = process.env.MANIA_DIFFICULTY_UPSTREAM;
process.env.MANIA_DIFFICULTY_UPSTREAM = probeRoot;

const result = await $`dotnet run --project ${join(pkgRoot, "tools/Transpiler")}`.nothrow().quiet();
process.env.MANIA_DIFFICULTY_UPSTREAM = prev;
rmSync(probeRoot, { recursive: true, force: true });

const err = result.stderr.toString() + result.stdout.toString();
if (result.exitCode === 0) {
  console.error("expected transpiler failure for out-param");
  console.error(err);
  process.exit(1);
}
if (!err.includes("ERROR:") || !err.includes("ref/out")) {
  console.error("expected ERROR about ref/out, got:");
  console.error(err);
  process.exit(1);
}

console.error("[probe] unsupported construct fails loudly — ok");
