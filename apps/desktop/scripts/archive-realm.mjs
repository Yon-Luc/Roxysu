#!/usr/bin/env node
/**
 * Compress staged realm-reader into a single tarball for electron-builder.
 * Must run AFTER rebuild:native so natives are baked into the archive.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stageDir = path.resolve(__dirname, "../stage");
const realmDir = path.join(stageDir, "realm-reader");
const archive = path.join(stageDir, "realm-reader.tgz");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed with code ${result.status}`);
  }
}

if (!existsSync(path.join(realmDir, "index.js"))) {
  throw new Error(`missing staged realm-reader at ${realmDir}`);
}

if (existsSync(archive)) rmSync(archive);
console.log("[archive-realm] creating realm-reader.tgz");
run("tar", ["-czf", archive, "-C", stageDir, "realm-reader"]);
rmSync(realmDir, { recursive: true, force: true });

const mb = (statSync(archive).size / (1024 * 1024)).toFixed(1);
console.log(`[archive-realm] ok size=${mb}MB path=${archive}`);
