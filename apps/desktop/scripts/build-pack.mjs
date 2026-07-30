#!/usr/bin/env node
/**
 * Stage Roxysu server + realm-reader + UI for electron-builder extraResources.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const stageDir = path.join(desktopRoot, "stage");

const NATIVE_EXTERNALS = ["better-sqlite3", "@napi-rs/lzma", "realm"];

function log(step) {
  console.log(`[build-pack] ${step}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with code ${result.status}`);
  }
}

function installProductionDeps(cwd, label) {
  log(`installing native deps in ${label}`);
  if (existsSync(path.join(cwd, "package-lock.json"))) {
    run("npm", ["ci", "--omit=dev"], { cwd });
    return;
  }
  try {
    run("npm", ["install", "--omit=dev", "--no-package-lock", "--foreground-scripts"], { cwd });
  } catch {
    run("bun", ["install", "--production"], { cwd });
  }
}

async function bundleEntry({ entry, outfile, label }) {
  log(`bundling ${label}`);
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile,
    sourcemap: true,
    logLevel: "info",
    packages: "bundle",
    external: NATIVE_EXTERNALS,
  });
}

async function main() {
  log("cleaning stage");
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(path.join(stageDir, "server"), { recursive: true });
  mkdirSync(path.join(stageDir, "realm-reader", "schemas"), { recursive: true });

  log("building UI");
  run("bun", ["run", "--cwd", path.join(repoRoot, "apps/server"), "build:ui"]);

  const publicDir = path.join(repoRoot, "apps/server/dist/public");
  if (!existsSync(path.join(publicDir, "index.html"))) {
    throw new Error(`missing UI build at ${publicDir}`);
  }

  log("copying static assets");
  cpSync(publicDir, path.join(stageDir, "public"), { recursive: true });

  log("copying drizzle migrations");
  cpSync(
    path.join(repoRoot, "packages/db/drizzle"),
    path.join(stageDir, "server/drizzle"),
    { recursive: true },
  );

  log("copying realm schema");
  cpSync(
    path.join(repoRoot, "apps/realm-reader/schemas/osu-client.schema.json"),
    path.join(stageDir, "realm-reader/schemas/osu-client.schema.json"),
  );

  await bundleEntry({
    entry: path.join(repoRoot, "apps/server/src/index.node.ts"),
    outfile: path.join(stageDir, "server/index.node.js"),
    label: "server",
  });

  await bundleEntry({
    entry: path.join(repoRoot, "apps/realm-reader/src/index.ts"),
    outfile: path.join(stageDir, "realm-reader/index.js"),
    label: "realm-reader",
  });

  await bundleEntry({
    entry: path.join(repoRoot, "apps/realm-reader/src/syncCollections.ts"),
    outfile: path.join(stageDir, "realm-reader/syncCollections.js"),
    label: "realm-reader syncCollections",
  });

  writeFileSync(
    path.join(stageDir, "server/package.json"),
    `${JSON.stringify(
      {
        name: "roxysu-server-stage",
        private: true,
        type: "module",
        dependencies: {
          "better-sqlite3": "^12.10.0",
          "@napi-rs/lzma": "^1.5.1",
        },
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    path.join(stageDir, "realm-reader/package.json"),
    `${JSON.stringify(
      {
        name: "roxysu-realm-reader-stage",
        private: true,
        type: "module",
        dependencies: {
          realm: "^12.14.0",
          "better-sqlite3": "^12.10.0",
        },
      },
      null,
      2,
    )}\n`,
  );

  installProductionDeps(path.join(stageDir, "server"), "server");
  installProductionDeps(path.join(stageDir, "realm-reader"), "realm-reader");

  log("done — run rebuild:native before electron-builder");
}

main().catch((err) => {
  console.error("[build-pack]", err);
  process.exit(1);
});
