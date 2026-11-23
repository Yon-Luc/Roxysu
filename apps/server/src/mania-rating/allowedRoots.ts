import { existsSync } from "node:fs";
import path from "node:path";

/** Split a path-list env var (`:` on POSIX, `;` on Windows). */
function envPathList(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Nearest ancestor with a Bun lockfile is the dev monorepo root. */
function findRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      existsSync(path.join(dir, "bun.lock")) ||
      existsSync(path.join(dir, "bun.lockb"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Roots a Rating Lab calculator binary may be loaded from.
 *
 * The calculator is a native build the user publishes themselves
 * (`docs/mania-rating-lab.md` puts it under `<repo>/dist/<version>` or
 * `~/roxysu-calc/<version>/mania-rating-calc`), so the allowlist covers those
 * documented trees plus the app-managed data / resource directories.
 * Builds kept elsewhere need `ROXYSU_CALCULATOR_ROOTS` (path-list) instead of
 * silently widening the allowlist to any absolute file.
 *
 * Shared by the settings PATCH validator and the spawn path, so a stored path
 * cannot bypass the check by predating it.
 */
export function maniaRatingAllowedRoots(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string[] {
  const roots = new Set<string>();
  const add = (value: string | undefined | null) => {
    if (value?.trim()) roots.add(path.resolve(value.trim()));
  };

  for (const entry of envPathList(env.ROXYSU_CALCULATOR_ROOTS)) add(entry);

  const dataDir = env.ROXYSU_DATA_DIR?.trim();
  if (dataDir) {
    add(path.join(dataDir, "calculators"));
    add(path.join(dataDir, "mania-rating"));
  }

  const resourcesDir = env.ROXYSU_RESOURCES?.trim();
  if (resourcesDir) {
    add(path.join(resourcesDir, "tools"));
    add(path.join(resourcesDir, "calculators"));
  }

  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (home) add(path.join(home, "roxysu-calc"));

  const repoRoot = findRepoRoot(cwd);
  if (repoRoot) {
    add(path.join(repoRoot, "dist"));
    add(path.join(repoRoot, "tools", "mania-rating-calc"));
  }

  return [...roots];
}
