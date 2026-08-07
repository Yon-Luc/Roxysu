#!/usr/bin/env node
/**
 * Assert the Linux resources tarball contains the Nix flake payload.
 * Usage: node scripts/assert-linux-resources.mjs [path-to.tar.gz]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(desktopRoot, "release");

const pkg = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);
const defaultArtifact = path.join(
  releaseDir,
  `Roxysu-${pkg.version}-linux-x64-resources.tar.gz`,
);
const artifact = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultArtifact;

if (!existsSync(artifact)) {
  console.error(`[assert-linux-resources] MISSING ${artifact}`);
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), "roxysu-linux-resources-"));
try {
  const tar = spawnSync("tar", ["-xzf", artifact, "-C", tmp], {
    encoding: "utf8",
  });
  if (tar.status !== 0) {
    console.error(tar.stderr || tar.stdout);
    throw new Error("tar extract failed");
  }

  const root = path.join(tmp, "roxysu");
  const checks = [
    "main.js",
    "preload.js",
    "paths.js",
    "package.json",
    "resources/splash.html",
    "resources/public/index.html",
    "resources/server/index.node.js",
    "resources/node/node",
    "resources/realm-reader.tgz",
    "resources/manifest.json",
  ];

  let failed = false;
  for (const rel of checks) {
    const file = path.join(root, rel);
    if (!existsSync(file)) {
      console.error(`[assert-linux-resources] MISSING ${rel}`);
      failed = true;
    } else {
      console.log(`[assert-linux-resources] ok ${rel}`);
    }
  }

  const manifestPath = path.join(root, "resources/manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.version !== pkg.version) {
      console.error(
        `[assert-linux-resources] manifest version ${manifest.version} != package ${pkg.version}`,
      );
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log(`[assert-linux-resources] all checks passed (${artifact})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
