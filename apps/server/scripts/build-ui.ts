#!/usr/bin/env bun
/**
 * Build the React UI into dist/public for the Node / Electron static server.
 * Bun fullstack is not available under @elysiajs/node, so we prebundle here.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

const root = path.resolve(import.meta.dir, "..");
const publicDir = path.join(root, "public");
const outDir = path.join(root, "dist", "public");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(publicDir, "index.tsx")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: "none",
  plugins: [tailwindPlugin],
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  console.error("[build:ui] bundle failed");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const jsEntry = result.outputs.find(
  (o) => o.kind === "entry-point" && o.path.endsWith(".js"),
);
const cssOutputs = result.outputs.filter((o) => o.path.endsWith(".css"));

if (!jsEntry) {
  console.error("[build:ui] no JS entry output");
  process.exit(1);
}

const jsHref = "./" + path.relative(outDir, jsEntry.path).replaceAll("\\", "/");
const cssHrefs = cssOutputs.map(
  (o) => "./" + path.relative(outDir, o.path).replaceAll("\\", "/"),
);

let html = readFileSync(path.join(publicDir, "index.html"), "utf8");
html = html.replace(
  /<link rel="stylesheet" href="tailwindcss">\s*/,
  cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n\t\t") +
    "\n\t\t",
);
html = html.replace(
  /<script type="module" src="\.\/index\.tsx"><\/script>/,
  `<script type="module" src="${jsHref}"></script>`,
);

writeFileSync(path.join(outDir, "index.html"), html);

// Static assets referenced by index.html / PWA (not emitted by the JS bundle).
for (const rel of [
  "roxy.png",
  "roxyctb.png",
  "manifest.webmanifest",
  "icons",
  "sw.js",
]) {
  const src = path.join(publicDir, rel);
  if (!existsSync(src)) continue;
  const dest = path.join(outDir, rel);
  cpSync(src, dest, { recursive: true });
}

console.log(`[build:ui] wrote ${outDir}`);
console.log(`[build:ui] entry ${jsHref}`);
for (const href of cssHrefs) console.log(`[build:ui] css ${href}`);
