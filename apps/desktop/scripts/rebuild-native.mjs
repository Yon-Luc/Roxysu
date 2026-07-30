#!/usr/bin/env node
/**
 * Ensure staged native addons load under the bundled Node ABI.
 * Prefer existing prebuilds from build-pack; only rebuild when bindings are missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  return process.env.ROXYSU_NODE_VERSION || process.versions.node;
}

/** @param {string} dir */
function findNativeBindings(dir) {
  /** @type {string[]} */
  const found = [];
  if (!existsSync(dir)) return found;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".git" || ent.name === "docs") continue;
        stack.push(full);
      } else if (ent.name.endsWith(".node")) {
        found.push(full);
      }
    }
  }
  return found;
}

/**
 * @param {string} moduleDir
 * @param {string} mod
 */
function hasBinding(moduleDir, mod) {
  const modDir = path.join(moduleDir, "node_modules", mod);
  if (findNativeBindings(modDir).length > 0) return true;
  // @napi-rs/* ships platform packages as siblings (e.g. lzma-win32-x64-msvc).
  if (mod.startsWith("@napi-rs/")) {
    const scopeDir = path.join(moduleDir, "node_modules", "@napi-rs");
    if (!existsSync(scopeDir)) return false;
    const short = mod.slice("@napi-rs/".length);
    for (const name of readdirSync(scopeDir)) {
      if (name === short || name.startsWith(`${short}-`)) {
        if (findNativeBindings(path.join(scopeDir, name)).length > 0) return true;
      }
    }
  }
  return false;
}

/**
 * Smoke-load a native module with the staged Node binary.
 * @param {string} moduleDir
 * @param {string} mod
 */
function canRequireWithStagedNode(moduleDir, mod) {
  if (!existsSync(nodeBin)) return false;
  const result = spawnSync(
    nodeBin,
    ["-e", `require(${JSON.stringify(mod)}); console.log('ok')`],
    {
      cwd: moduleDir,
      encoding: "utf8",
      env: { ...process.env, REALM_DISABLE_ANALYTICS: "1" },
    },
  );
  if (result.status === 0) return true;
  console.warn(
    `[rebuild-native] require(${mod}) failed under staged node:\n${result.stderr || result.stdout}`,
  );
  return false;
}

/**
 * @param {string} moduleDir
 * @param {string[]} modules
 * @param {string} version
 */
function ensureModules(moduleDir, modules, version) {
  console.log(
    `[rebuild-native] ${moduleDir}: ${modules.join(", ")} (node ${version})`,
  );
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
    REALM_DISABLE_ANALYTICS: "1",
    npm_node_execpath: nodeBin,
  };

  for (const mod of modules) {
    const modDir = path.join(moduleDir, "node_modules", mod);
    if (!existsSync(modDir)) {
      console.warn(`[rebuild-native] skip missing ${mod}`);
      continue;
    }

    const bindings = findNativeBindings(path.join(moduleDir, "node_modules", mod));
    const napiOk = hasBinding(moduleDir, mod);
    if ((bindings.length > 0 || napiOk) && canRequireWithStagedNode(moduleDir, mod)) {
      console.log(`[rebuild-native] ${mod}: ok`);
      continue;
    }

    // @napi-rs packages: reinstall optional platform binary instead of node-gyp.
    if (mod.startsWith("@napi-rs/")) {
      console.log(`[rebuild-native] ${mod}: reinstalling optional platform package`);
      const reinstall = spawnSync(
        "npm",
        ["install", mod, "--omit=dev", "--include=optional", "--no-save"],
        {
          cwd: moduleDir,
          env,
          stdio: "inherit",
          shell: process.platform === "win32",
        },
      );
      if (reinstall.status !== 0 || !canRequireWithStagedNode(moduleDir, mod)) {
        throw new Error(
          `${mod} has no working native binding for bundled Node ${version}`,
        );
      }
      console.log(`[rebuild-native] ${mod}: reinstalled ok`);
      continue;
    }

    console.log(`[rebuild-native] ${mod}: fetching/rebuilding prebuild for node ${version}`);
    const npmResult = spawnSync(
      "npm",
      ["rebuild", mod, `--target=${version}`, "--runtime=node"],
      {
        cwd: moduleDir,
        env,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    if (npmResult.status !== 0 || !canRequireWithStagedNode(moduleDir, mod)) {
      // Try prebuild-install directly when present.
      const prebuildBin = path.join(
        modDir,
        "node_modules",
        "prebuild-install",
        "bin.js",
      );
      const localPrebuild = existsSync(prebuildBin)
        ? prebuildBin
        : path.join(moduleDir, "node_modules/prebuild-install/bin.js");
      if (existsSync(localPrebuild) || existsSync(path.join(modDir, "package.json"))) {
        const pkg = JSON.parse(
          readFileSync(path.join(modDir, "package.json"), "utf8"),
        );
        const installScript = pkg.scripts?.install;
        if (installScript) {
          // Unset build-from-source so prebuild-install can download.
          const installEnv = { ...env };
          delete installEnv.npm_config_build_from_source;
          const installResult = spawnSync(installScript, {
            shell: true,
            cwd: modDir,
            env: installEnv,
            stdio: "inherit",
          });
          if (installResult.status !== 0) {
            throw new Error(`rebuild failed for ${mod}`);
          }
        } else if (npmResult.status !== 0) {
          throw new Error(`rebuild failed for ${mod}`);
        }
      } else {
        throw new Error(`rebuild failed for ${mod}`);
      }
    }

    if (!hasBinding(moduleDir, mod) || !canRequireWithStagedNode(moduleDir, mod)) {
      throw new Error(
        `${mod} has no working native binding for bundled Node ${version}`,
      );
    }
    console.log(`[rebuild-native] ${mod}: rebuilt ok`);
  }
}

function main() {
  const version = nodeVersion();
  ensureModules(
    path.join(stageDir, "server"),
    ["better-sqlite3", "@napi-rs/lzma"],
    version,
  );

  const realmDir = path.join(stageDir, "realm-reader");
  if (!existsSync(path.join(realmDir, "package.json"))) {
    throw new Error(
      "realm-reader missing from stage — run build:stage before rebuild:native",
    );
  }
  ensureModules(realmDir, ["realm", "better-sqlite3"], version);
  console.log("[rebuild-native] done");
}

main();
