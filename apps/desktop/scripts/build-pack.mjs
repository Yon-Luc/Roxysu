#!/usr/bin/env node
/**
 * Stage Roxysu server + realm-reader + UI for electron-builder extraResources.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const stageDir = path.join(desktopRoot, "stage");

const NATIVE_EXTERNALS = ["better-sqlite3", "@napi-rs/lzma", "realm"];
const NATIVE_INSTALL_PKGS = ["better-sqlite3", "@napi-rs/lzma", "realm"];

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

function nativeInstallPackages(cwd) {
  const pkgJson = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  const deps = { ...pkgJson.dependencies, ...pkgJson.optionalDependencies };
  return NATIVE_INSTALL_PKGS.filter((name) => deps[name]);
}

/** Run package `install` scripts only — skips realm's broken analytics postinstall. */
function runNativeInstallScripts(cwd, packages) {
  const binDir = path.join(cwd, "node_modules", ".bin");
  const env = {
    ...process.env,
    REALM_DISABLE_ANALYTICS: "1",
    PATH: existsSync(binDir)
      ? `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
      : process.env.PATH,
  };
  for (const pkg of packages) {
    const modDir = path.join(cwd, "node_modules", pkg);
    const pkgJsonPath = path.join(modDir, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const installScript = JSON.parse(readFileSync(pkgJsonPath, "utf8")).scripts?.install;
    if (!installScript) continue;
    log(`native install: ${pkg}`);
    const result = spawnSync(installScript, {
      shell: true,
      cwd: modDir,
      stdio: "inherit",
      env,
    });
    if (result.status !== 0) {
      throw new Error(`${pkg} install script failed with code ${result.status}`);
    }
  }
}

function installProductionDeps(cwd, label) {
  log(`installing native deps in ${label}`);
  const env = { ...process.env, REALM_DISABLE_ANALYTICS: "1" };
  const installArgs = ["--omit=dev", "--ignore-scripts"];
  if (existsSync(path.join(cwd, "package-lock.json"))) {
    run("npm", ["ci", ...installArgs], { cwd, env });
  } else {
    try {
      run("npm", ["install", ...installArgs, "--no-package-lock"], { cwd, env });
    } catch {
      run("bun", ["install", "--production", "--ignore-scripts"], { cwd, env });
    }
  }
  runNativeInstallScripts(cwd, nativeInstallPackages(cwd));
}

function stagePackageJson(name, dependencies) {
  const allowScripts = Object.fromEntries(
    Object.keys(dependencies).map((pkg) => [pkg, true]),
  );
  return {
    name,
    private: true,
    type: "module",
    dependencies,
    allowScripts,
    trustedDependencies: Object.keys(dependencies),
  };
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

  const serverDeps = {
    "better-sqlite3": "^12.10.0",
    "@napi-rs/lzma": "^1.5.1",
  };
  const realmReaderDeps = {
    realm: "^12.14.0",
    "better-sqlite3": "^12.10.0",
  };

  writeFileSync(
    path.join(stageDir, "server/package.json"),
    `${JSON.stringify(stagePackageJson("roxysu-server-stage", serverDeps), null, 2)}\n`,
  );

  writeFileSync(
    path.join(stageDir, "realm-reader/package.json"),
    `${JSON.stringify(stagePackageJson("roxysu-realm-reader-stage", realmReaderDeps), null, 2)}\n`,
  );

  installProductionDeps(path.join(stageDir, "server"), "server");
  installProductionDeps(path.join(stageDir, "realm-reader"), "realm-reader");

  log("done — run rebuild:native before electron-builder");
}

main().catch((err) => {
  console.error("[build-pack]", err);
  process.exit(1);
});
