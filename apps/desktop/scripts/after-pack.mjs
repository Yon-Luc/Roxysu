#!/usr/bin/env node
/**
 * electron-builder afterPack: on Windows, rename the Electron binary to
 * RoxysuApp.exe and install the Win32 bootstrap splash as Roxysu.exe.
 *
 * The bootstrap must wait for RoxysuApp.exe to exit — portable NSIS ExecWaits
 * on Roxysu.exe then deletes the unpack directory.
 */
import { existsSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const launcherSrc = path.join(desktopRoot, "launcher/win/dist/Roxysu.exe");

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const appOutDir = context.appOutDir;
  const electronExe = path.join(appOutDir, "Roxysu.exe");
  const appExe = path.join(appOutDir, "RoxysuApp.exe");

  if (!existsSync(electronExe)) {
    throw new Error(`[after-pack] missing Electron exe at ${electronExe}`);
  }
  if (!existsSync(launcherSrc)) {
    throw new Error(
      `[after-pack] missing Win32 launcher at ${launcherSrc} — run build-win-launcher first`,
    );
  }

  if (existsSync(appExe)) unlinkSync(appExe);
  renameSync(electronExe, appExe);
  copyFileSync(launcherSrc, electronExe);
  console.log(
    `[after-pack] Roxysu.exe = bootstrap splash → launches ${path.basename(appExe)}`,
  );
}
