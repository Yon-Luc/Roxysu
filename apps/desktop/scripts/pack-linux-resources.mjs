#!/usr/bin/env node
/**
 * Assemble a Linux resources tarball for the Nix flake prebuilt package.
 *
 * Layout (top-level `roxysu/`):
 *   main.js, preload.js, …   Electron app root
 *   resources/
 *     public/ server/ node/ splash.html
 *     realm-reader.tgz       extracted at Nix install time for autoPatchelf
 *
 * Prerequisites: run `bun run pack` first (stage + natives + realm archive).
 *
 * Output: release/Roxysu-${version}-linux-x64-resources.tar.gz
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const stageDir = path.join(desktopRoot, "stage");
const releaseDir = path.join(desktopRoot, "release");
const bundleRoot = path.join(releaseDir, "linux-resources", "roxysu");

const pkg = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);
const version = pkg.version;
const artifactName = `Roxysu-${version}-linux-x64-resources.tar.gz`;
const artifactPath = path.join(releaseDir, artifactName);

function log(step) {
  console.log(`[pack-linux-resources] ${step}`);
}

function mustExist(file, hint) {
  if (!existsSync(file)) {
    throw new Error(`missing ${file}${hint ? ` — ${hint}` : ""}`);
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with code ${result.status}`);
  }
}

mustExist(
  path.join(stageDir, "public", "index.html"),
  "run `bun run pack` first",
);
mustExist(
  path.join(stageDir, "server", "index.node.js"),
  "run `bun run pack` first",
);
mustExist(
  path.join(stageDir, "realm-reader.tgz"),
  "run `bun run pack` (includes archive:realm)",
);
mustExist(
  path.join(stageDir, "node", "node"),
  "staged Linux Node runtime required",
);
mustExist(path.join(stageDir, "splash.html"));

if (process.platform !== "linux") {
  console.warn(
    `[pack-linux-resources] warning: packing on ${process.platform}; ` +
      "natives/Node must be linux-x64 (use CI or a Linux host)",
  );
}

log("assembling bundle");
rmSync(path.join(releaseDir, "linux-resources"), {
  recursive: true,
  force: true,
});
mkdirSync(path.join(bundleRoot, "resources"), { recursive: true });

const appFiles = [
  "main.js",
  "auto-update.js",
  "preload.js",
  "paths.js",
  "splash.html",
  "package.json",
];
for (const name of appFiles) {
  cpSync(path.join(desktopRoot, name), path.join(bundleRoot, name));
}

cpSync(path.join(stageDir, "public"), path.join(bundleRoot, "resources", "public"), {
  recursive: true,
});
cpSync(path.join(stageDir, "server"), path.join(bundleRoot, "resources", "server"), {
  recursive: true,
});
cpSync(path.join(stageDir, "node"), path.join(bundleRoot, "resources", "node"), {
  recursive: true,
});
cpSync(
  path.join(stageDir, "splash.html"),
  path.join(bundleRoot, "resources", "splash.html"),
);
cpSync(
  path.join(stageDir, "realm-reader.tgz"),
  path.join(bundleRoot, "resources", "realm-reader.tgz"),
);

const nodeVersion = existsSync(path.join(stageDir, "node", "VERSION"))
  ? readFileSync(path.join(stageDir, "node", "VERSION"), "utf8").trim()
  : process.versions.node;

writeFileSync(
  path.join(bundleRoot, "resources", "manifest.json"),
  `${JSON.stringify(
    {
      product: "Roxysu",
      version,
      platform: "linux-x64",
      nodeVersion,
      packedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

run("chmod", ["+x", path.join(bundleRoot, "resources", "node", "node")]);

mkdirSync(releaseDir, { recursive: true });
if (existsSync(artifactPath)) rmSync(artifactPath);

log(`creating ${artifactName}`);
run("tar", ["-czf", artifactPath, "-C", path.join(releaseDir, "linux-resources"), "roxysu"]);

# Stable name for flake input `releases/latest/download/…` (nix flake update).
const stableName = "Roxysu-linux-x64-resources.tar.gz";
const stablePath = path.join(releaseDir, stableName);
cpSync(artifactPath, stablePath);

const mb = (statSync(artifactPath).size / (1024 * 1024)).toFixed(1);
log(`ok size=${mb}MB path=${artifactPath}`);
log(`ok stable alias → ${stablePath}`);
log(`node=${nodeVersion} version=${version}`);
