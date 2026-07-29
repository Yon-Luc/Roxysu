#!/usr/bin/env node
/**
 * Launch Electron.
 *
 * On NixOS, use the nixpkgs-wrapped binary (`ELECTRON_PATH` / `electron` on
 * PATH). The raw `libexec/electron/electron` path (what
 * ELECTRON_OVERRIDE_DIST_PATH normally selects) can SIGILL without the wrapper.
 *
 * Elsewhere, fall back to the npm `electron` package binary.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function which(cmd) {
  const result = spawnSync("sh", ["-c", `command -v ${cmd}`], {
    encoding: "utf8",
  });
  const resolved = result.stdout?.trim();
  return resolved || null;
}

function resolveElectronBinary() {
  const fromEnv = process.env.ELECTRON_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const fromPath = which("electron");
  if (fromPath) return fromPath;

  // npm electron package exports the binary path when required from Node.
  return /** @type {string} */ (require("electron"));
}

const electronBin = resolveElectronBinary();
const args = process.argv.slice(2);
const child = spawn(electronBin, args.length > 0 ? args : ["."], {
  cwd: appRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`${electronBin} exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
