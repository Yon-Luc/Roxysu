#!/usr/bin/env node
/**
 * Rebuild staged native addons against the bundled Node ABI (not Electron).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const stageDir = path.join(desktopRoot, "stage");
const nodeDir = path.join(stageDir, "node");
const nodeBin = path.join(
  nodeDir,
  process.platform === "win32" ? "node.exe" : "node",
);

function nodeVersion() {
  const versionFile = path.join(nodeDir, "VERSION");
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, "utf8").trim();
  }
  return process.env.ROXYSU_NODE_VERSION || "22.14.0";
}

function rebuildModule(moduleDir, modules, version) {
  console.log(`[rebuild-native] ${moduleDir}: ${modules.join(", ")} (node ${version})`);
  if (!existsSync(nodeBin)) {
    throw new Error(
      `bundled node missing at ${nodeBin} — run build:stage first`,
    );
  }

  const env = {
    ...process.env,
    npm_config_runtime: "node",
    npm_config_target: version,
    npm_config_disturl: "https://nodejs.org/download/release",
    npm_config_build_from_source: "true",
    REALM_DISABLE_ANALYTICS: "1",
  };

  for (const mod of modules) {
    const modDir = path.join(moduleDir, "node_modules", mod);
    if (!existsSync(modDir)) {
      console.warn(`[rebuild-native] skip missing ${mod}`);
      continue;
    }

    // Prefer npm rebuild with staged node as the runtime for prebuilds/node-gyp.
    console.log(`[rebuild-native] npm rebuild ${mod}`);
    const npmResult = spawnSync(
      "npm",
      ["rebuild", mod, `--target=${version}`, "--runtime=node"],
      {
        cwd: moduleDir,
        env: { ...env, npm_node_execpath: nodeBin },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    if (npmResult.status === 0) continue;

    const pkgJsonPath = path.join(modDir, "package.json");
    const installScript = JSON.parse(readFileSync(pkgJsonPath, "utf8")).scripts
      ?.install;
    if (!installScript) {
      console.warn(
        `[rebuild-native] ${mod}: npm rebuild failed and no install script — assuming prebuilt ok`,
      );
      continue;
    }
    console.log(`[rebuild-native] install script for ${mod}`);
    const installResult = spawnSync(installScript, {
      shell: true,
      cwd: modDir,
      env: { ...env, npm_node_execpath: nodeBin },
      stdio: "inherit",
    });
    if (installResult.status !== 0) {
      throw new Error(`rebuild failed for ${mod}`);
    }
  }
}

function main() {
  const version = nodeVersion();
  rebuildModule(path.join(stageDir, "server"), ["better-sqlite3", "@napi-rs/lzma"], version);

  const realmDir = path.join(stageDir, "realm-reader");
  if (!existsSync(path.join(realmDir, "package.json"))) {
    throw new Error(
      "realm-reader missing from stage — run build:stage before rebuild:native (archive comes after)",
    );
  }
  rebuildModule(realmDir, ["realm", "better-sqlite3"], version);
  console.log("[rebuild-native] done");
}

main();
