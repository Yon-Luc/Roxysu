#!/usr/bin/env bun
/**
 * Build the standalone tosu counter into dist/RoxysuPreview/ plus a zip for
 * distribution (manual drop into tosu's static/ dir, or the tosu dashboard's
 * counter downloader).
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { boxResize, decodePng, encodePng } from "../src/pngShrink";

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

// Static counter files. The watermark logo is downscaled to 64px at build
// time — the source art is 1024px/1.6MB and the counter draws it at ≤32px.
{
  const logoBytes = readFileSync(path.join(root, "public", "roxy.png"));
  try {
    const small = encodePng(boxResize(decodePng(logoBytes), 64, 64));
    await Bun.write(path.join(outDir, "roxy-small.png"), small);
    console.log(
      `[tosu-counter] logo shrunk: ${(logoBytes.length / 1024).toFixed(0)} KiB → ${(small.length / 1024).toFixed(1)} KiB`,
    );
  } catch (err) {
    console.warn(
      "[tosu-counter] logo shrink failed, shipping original:",
      err instanceof Error ? err.message : String(err),
    );
    await Bun.write(path.join(outDir, "roxy-small.png"), logoBytes);
  }
}
for (const rel of ["index.html", "metadata.txt", "settings.json"]) {
  const text = readFileSync(path.join(root, "public", rel), "utf8");
  await Bun.write(path.join(outDir, rel), text);
}

// Placeholder folder-skin pack: the counter probes ./skin/skin-pack.json on
// every boot, and tosu logs an ENOENT error line when the file is missing.
// An empty object validates as "no pack" (folderSkin.validateSkinPack needs
// at least one sprite), so behavior is identical to a missing file — minus
// the log noise. A real exported pack replaces this file.
mkdirSync(path.join(outDir, "skin"), { recursive: true });
await Bun.write(path.join(outDir, "skin", "skin-pack.json"), "{}\n");

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
for (const rel of [
  "index.html",
  "metadata.txt",
  "settings.json",
  "bundle.js",
  "roxy-small.png",
  "skin/skin-pack.json",
]) {
  files[`RoxysuPreview/${rel}`] = new Uint8Array(
    readFileSync(path.join(outDir, rel)),
  );
}
const zipped = zipSync(files, { level: 9 });
await Bun.write(path.join(root, "dist", "RoxysuPreview.zip"), zipped);
console.log(
  `[tosu-counter] wrote ${path.relative(root, outDir)} and RoxysuPreview.zip (${(zipped.length / 1024).toFixed(1)} KiB)`,
);
