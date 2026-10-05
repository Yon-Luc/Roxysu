#!/usr/bin/env bun
/**
 * Ensure a local checkout of the pinned upstream revision exists.
 * Does not modify revision.json (use manually or a future update flow).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const pkgRoot = join(import.meta.dir, "../..");
const revision = JSON.parse(
  readFileSync(join(pkgRoot, "upstream/revision.json"), "utf8"),
) as {
  repository: string;
  branch: string;
  sha: string;
};

const cacheDir =
  process.env.MANIA_DIFFICULTY_UPSTREAM ?? join(pkgRoot, ".cache/upstream");

mkdirSync(join(pkgRoot, ".cache"), { recursive: true });

if (!existsSync(join(cacheDir, ".git"))) {
  console.error(`[pin] cloning ${revision.repository} → ${cacheDir}`);
  await $`git clone --branch ${revision.branch} --single-branch ${revision.repository} ${cacheDir}`;
} else {
  console.error(`[pin] fetching ${revision.branch} in ${cacheDir}`);
  await $`git -C ${cacheDir} fetch origin ${revision.branch}`;
}

console.error(`[pin] checking out ${revision.sha}`);
await $`git -C ${cacheDir} checkout ${revision.sha}`;

const head = (await $`git -C ${cacheDir} rev-parse HEAD`.text()).trim();
if (head !== revision.sha) {
  console.error(`[pin] HEAD ${head} != pinned ${revision.sha}`);
  process.exit(1);
}

console.error(`[pin] ok ${head}`);
console.log(cacheDir);
