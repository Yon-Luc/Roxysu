#!/usr/bin/env node
/**
 * Stage Roxysu server + realm-reader + UI + Node runtime for electron-builder.
 *
 * Realm is archived to realm-reader.tgz so the install tree stays small for AV.
 * Natives are built against the bundled Node ABI (not Electron).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const stageDir = path.join(desktopRoot, "stage");
const require = createRequire(import.meta.url);

/** Keep in sync with the Node that runs the pack (CI setup-node). Override via env. */
const NODE_VERSION =
  process.env.ROXYSU_NODE_VERSION || process.versions.node;

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
    shell: options.shell ?? false,
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
function runNativeInstallScripts(cwd, packages, nodeBin) {
  const binDir = path.join(cwd, "node_modules", ".bin");
  const env = {
    ...process.env,
    REALM_DISABLE_ANALYTICS: "1",
    npm_config_runtime: "node",
    npm_config_target: NODE_VERSION,
    npm_config_disturl: "https://nodejs.org/download/release",
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
      env: {
        ...env,
        // Prefer staged node for node-gyp when present.
        npm_node_execpath: nodeBin || process.execPath,
      },
    });
    if (result.status !== 0) {
      throw new Error(`${pkg} install script failed with code ${result.status}`);
    }
  }
}

function installProductionDeps(cwd, label, nodeBin) {
  log(`installing native deps in ${label}`);
  const env = {
    ...process.env,
    REALM_DISABLE_ANALYTICS: "1",
    npm_config_runtime: "node",
    npm_config_target: NODE_VERSION,
    npm_config_disturl: "https://nodejs.org/download/release",
  };
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
  runNativeInstallScripts(cwd, nativeInstallPackages(cwd), nodeBin);
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
  log(`bundling ${label} (minify)`);
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile,
    sourcemap: true,
    minify: true,
    logLevel: "info",
    packages: "bundle",
    external: NATIVE_EXTERNALS,
  });
}

function nodeDistName() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `node-v${NODE_VERSION}-win-${arch}`;
  if (process.platform === "darwin") return `node-v${NODE_VERSION}-darwin-${arch}`;
  return `node-v${NODE_VERSION}-linux-${arch}`;
}

function nodeDistUrl() {
  const name = nodeDistName();
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  return `https://nodejs.org/dist/v${NODE_VERSION}/${name}.${ext}`;
}

async function downloadNodeRuntime() {
  const destDir = path.join(stageDir, "node");
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const destBin = path.join(destDir, nodeName);
  if (existsSync(destBin)) {
    log(`node runtime already staged: ${destBin}`);
    return destBin;
  }

  mkdirSync(destDir, { recursive: true });
  const url = nodeDistUrl();
  log(`downloading Node ${NODE_VERSION}: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to download node: ${res.status} ${url}`);
  }

  const tmpDir = path.join(stageDir, ".node-download");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const archivePath = path.join(
    tmpDir,
    process.platform === "win32" ? "node.zip" : "node.tar.gz",
  );
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archivePath));

  if (process.platform === "win32") {
    // Prefer tar (Windows 10+); fallback to PowerShell Expand-Archive.
    const extractTry = spawnSync("tar", ["-xf", archivePath, "-C", tmpDir], {
      stdio: "inherit",
    });
    if (extractTry.status !== 0) {
      run(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
        ],
        { shell: true },
      );
    }
  } else {
    run("tar", ["-xzf", archivePath, "-C", tmpDir]);
  }

  const extractedRoot = path.join(tmpDir, nodeDistName());
  const extractedBin = path.join(
    extractedRoot,
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
  if (!existsSync(extractedBin)) {
    throw new Error(`node binary missing after extract: ${extractedBin}`);
  }
  cpSync(extractedBin, destBin);
  if (process.platform !== "win32") {
    try {
      run("chmod", ["+x", destBin]);
    } catch {
      // ignore
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
  log(`staged node → ${destBin}`);
  return destBin;
}

function copySplash() {
  const splashSrc = path.join(desktopRoot, "splash.html");
  if (!existsSync(splashSrc)) {
    throw new Error(`missing ${splashSrc}`);
  }
  cpSync(splashSrc, path.join(stageDir, "splash.html"));
}

async function main() {
  const preservedNode = path.join(stageDir, "node");
  const preservedVersion = path.join(preservedNode, "VERSION");
  let nodeCache = null;
  if (
    existsSync(path.join(preservedNode, process.platform === "win32" ? "node.exe" : "node")) &&
    existsSync(preservedVersion) &&
    readFileSync(preservedVersion, "utf8").trim() === NODE_VERSION
  ) {
    nodeCache = path.join(stageDir, ".node-preserve");
    rmSync(nodeCache, { recursive: true, force: true });
    cpSync(preservedNode, nodeCache, { recursive: true });
    log(`preserving cached Node ${NODE_VERSION}`);
  }

  log("cleaning stage");
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(path.join(stageDir, "server"), { recursive: true });
  mkdirSync(path.join(stageDir, "realm-reader", "schemas"), { recursive: true });

  if (nodeCache) {
    cpSync(nodeCache, path.join(stageDir, "node"), { recursive: true });
    rmSync(nodeCache, { recursive: true, force: true });
  }
  log("building UI");
  run("bun", ["run", "--cwd", path.join(repoRoot, "apps/server"), "build:ui"]);

  const publicDir = path.join(repoRoot, "apps/server/dist/public");
  if (!existsSync(path.join(publicDir, "index.html"))) {
    throw new Error(`missing UI build at ${publicDir}`);
  }

  log("copying static assets");
  cpSync(publicDir, path.join(stageDir, "public"), { recursive: true });
  copySplash();

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

  const nodeBin = await downloadNodeRuntime();

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

  installProductionDeps(path.join(stageDir, "server"), "server", nodeBin);
  installProductionDeps(path.join(stageDir, "realm-reader"), "realm-reader", nodeBin);

  // Record node version for rebuild-native / assert.
  // Realm stays unpacked until after rebuild:native (see archive-realm.mjs).
  writeFileSync(
    path.join(stageDir, "node", "VERSION"),
    `${NODE_VERSION}\n`,
  );

  log(`electron=${require("electron/package.json").version} (UI only; children use Node ${NODE_VERSION})`);
  log("done — run rebuild:native && archive-realm before electron-builder");
}

main().catch((err) => {
  console.error("[build-pack]", err);
  process.exit(1);
});
