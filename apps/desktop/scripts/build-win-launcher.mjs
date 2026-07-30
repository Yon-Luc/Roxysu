#!/usr/bin/env node
/**
 * Build the Win32 bootstrap splash (Roxysu.exe) with MSVC cl.exe.
 * No-op on non-Windows hosts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const src = path.join(desktopRoot, "launcher/win/roxysu_launcher.c");
const outDir = path.join(desktopRoot, "launcher/win/dist");
const outExe = path.join(outDir, "Roxysu.exe");

function findCl() {
  if (spawnSync("cl", ["/?"], { encoding: "utf8", shell: true }).status === 0) {
    return "cl";
  }
  // vswhere → latest MSVC
  const vswhere =
    process.env["ProgramFiles(x86)"] &&
    path.join(
      process.env["ProgramFiles(x86)"],
      "Microsoft Visual Studio/Installer/vswhere.exe",
    );
  if (vswhere && existsSync(vswhere)) {
    const r = spawnSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-find",
        "**/Hostx64/x64/cl.exe",
      ],
      { encoding: "utf8" },
    );
    const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean)[0];
    if (line && existsSync(line)) return line;
  }
  return null;
}

function main() {
  if (process.platform !== "win32") {
    console.log("[build-win-launcher] skip (not Windows)");
    return;
  }
  if (!existsSync(src)) {
    throw new Error(`missing launcher source: ${src}`);
  }
  mkdirSync(outDir, { recursive: true });

  const cl = findCl();
  if (!cl) {
    throw new Error(
      "MSVC cl.exe not found — install VS Build Tools with C++ workload",
    );
  }

  console.log(`[build-win-launcher] compiling with ${cl}`);
  const result = spawnSync(
    cl,
    [
      "/nologo",
      "/O2",
      `/Fe:${outExe}`,
      src,
      "user32.lib",
      "gdi32.lib",
      "shell32.lib",
      "shlwapi.lib",
      "/link",
      "/SUBSYSTEM:WINDOWS",
    ],
    { stdio: "inherit", shell: true, cwd: outDir },
  );
  if (result.status !== 0 || !existsSync(outExe)) {
    throw new Error("launcher compile failed");
  }
  console.log(`[build-win-launcher] wrote ${outExe}`);
}

main();
