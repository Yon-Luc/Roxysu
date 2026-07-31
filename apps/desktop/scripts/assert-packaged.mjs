#!/usr/bin/env node
/**
 * Assert packaged Windows/Linux tree includes splash + expected resources.
 * Usage: node scripts/assert-packaged.mjs [appOutDir]
 * Default: release/win-unpacked or release/linux-unpacked
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(desktopRoot, "release");

function pickDefaultOut() {
  const win = path.join(releaseDir, "win-unpacked");
  const linux = path.join(releaseDir, "linux-unpacked");
  if (existsSync(win)) return win;
  if (existsSync(linux)) return linux;
  return win;
}

const appOut = process.argv[2]
  ? path.resolve(process.argv[2])
  : pickDefaultOut();

const resources = path.join(appOut, "resources");
const checks = [
  path.join(resources, "splash.html"),
  path.join(resources, "public", "index.html"),
  path.join(resources, "server", "index.node.js"),
  path.join(resources, "realm-reader.tgz"),
];

const nodeBin = path.join(
  resources,
  "node",
  process.platform === "win32" ? "node.exe" : "node",
);
checks.push(nodeBin);

let failed = false;
for (const file of checks) {
  if (!existsSync(file)) {
    console.error(`[assert-packaged] MISSING ${file}`);
    failed = true;
  } else {
    console.log(`[assert-packaged] ok ${path.relative(appOut, file)}`);
  }
}

const splash = path.join(resources, "splash.html");
if (existsSync(splash)) {
  const html = readFileSync(splash, "utf8");
  if (!html.includes("Roxysu") || !html.includes("spinner")) {
    console.error("[assert-packaged] splash.html looks wrong");
    failed = true;
  }
}

if (process.platform === "win32") {
  const launcher = path.join(appOut, "Roxysu.exe");
  const app = path.join(appOut, "RoxysuApp.exe");
  for (const file of [launcher, app]) {
    if (!existsSync(file)) {
      console.error(`[assert-packaged] MISSING ${file}`);
      failed = true;
    } else {
      console.log(`[assert-packaged] ok ${path.basename(file)}`);
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("[assert-packaged] all checks passed");
