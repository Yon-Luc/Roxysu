#!/usr/bin/env node
/**
 * Compress staged realm-reader into a single tarball for electron-builder.
 * Must run AFTER rebuild:native so natives are baked into the archive.
 *
 * Prunes Realm Android/Apple prebuilds (hundreds of MB) — desktop only needs
 * prebuilds/node for the bundled Node runtime.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
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

function pruneRealmPrebuilds() {
  const prebuilds = path.join(realmDir, "node_modules/realm/prebuilds");
  for (const name of ["android", "apple"]) {
    const dir = path.join(prebuilds, name);
    if (existsSync(dir)) {
      console.log(`[archive-realm] pruning ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const nodePrebuild = path.join(prebuilds, "node/realm.node");
  if (!existsSync(nodePrebuild)) {
    throw new Error(
      `missing Node realm prebuild at ${nodePrebuild} — rebuild:native must succeed first`,
    );
  }
}

if (!existsSync(path.join(realmDir, "index.js"))) {
  throw new Error(`missing staged realm-reader at ${realmDir}`);
}

pruneRealmPrebuilds();

if (existsSync(archive)) rmSync(archive);
console.log("[archive-realm] creating realm-reader.tgz");
run("tar", ["-czf", archive, "-C", stageDir, "realm-reader"]);
rmSync(realmDir, { recursive: true, force: true });

const mb = (statSync(archive).size / (1024 * 1024)).toFixed(1);
console.log(`[archive-realm] ok size=${mb}MB path=${archive}`);
