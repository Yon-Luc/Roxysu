#!/usr/bin/env bun
/**
 * Build the standalone tosu counter into dist/RoxysuPreview/ plus a zip for
 * distribution (manual drop into tosu's static/ dir, or the tosu dashboard's
 * counter downloader).
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, "dist", "RoxysuPreview");

rmSync(path.join(root, "dist"), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(root, "src", "main.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "none",
  naming: {
    entry: "bundle.js",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  console.error("[tosu-counter] bundle failed");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Static counter files.
for (const rel of ["index.html", "metadata.txt"]) {
  const text = readFileSync(path.join(root, "public", rel), "utf8");
  await Bun.write(path.join(outDir, rel), text);
}

const jsEntry = result.outputs.find(
  (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
);
if (jsEntry) {
  console.log(
    `[tosu-counter] bundle ${(jsEntry.size / 1024).toFixed(1)} KiB (minified)`,
  );
}

// Zip for distribution / tosu dashboard install.
const files: Record<string, Uint8Array> = {};
for (const rel of ["index.html", "metadata.txt", "bundle.js"]) {
  files[`RoxysuPreview/${rel}`] = new Uint8Array(
    readFileSync(path.join(outDir, rel)),
  );
}
const zipped = zipSync(files, { level: 9 });
await Bun.write(path.join(root, "dist", "RoxysuPreview.zip"), zipped);
console.log(
  `[tosu-counter] wrote ${path.relative(root, outDir)} and RoxysuPreview.zip (${(zipped.length / 1024).toFixed(1)} KiB)`,
);
