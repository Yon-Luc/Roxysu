#!/usr/bin/env node
/**
 * Rebuild staged native addons against Electron's Node ABI.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const stageDir = path.join(desktopRoot, "stage");
const require = createRequire(import.meta.url);

const electronVersion = require("electron/package.json").version;

function runRebuild(moduleDir, modules) {
  console.log(`[rebuild-native] ${moduleDir}: ${modules.join(", ")}`);
  const result = spawnSync(
    process.execPath,
    [
      path.join(desktopRoot, "node_modules/@electron/rebuild/lib/cli.js"),
      "--version",
      electronVersion,
      "--force",
      "--module-dir",
      moduleDir,
      "--which-module",
      modules.join(","),
    ],
    { stdio: "inherit", cwd: desktopRoot },
  );
  if (result.status !== 0) {
    throw new Error(`electron-rebuild failed for ${moduleDir}`);
  }
}

function main() {
  runRebuild(path.join(stageDir, "server"), ["better-sqlite3", "@napi-rs/lzma"]);
  runRebuild(path.join(stageDir, "realm-reader"), ["realm", "better-sqlite3"]);
  console.log("[rebuild-native] done");
}

main();
