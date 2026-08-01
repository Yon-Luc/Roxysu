const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

/**
 * Resolve monorepo vs packaged Electron resource layouts.
 *
 * Packaged layout (electron-builder / Nix):
 *   resources/
 *     public/              built UI
 *     server/              Node server entry + deps
 *     node/                bundled Node runtime (node / node.exe) — optional on Nix
 *     splash.html          startup splash (also in asar)
 *     realm-reader/        unpacked realm (Nix) OR
 *     realm-reader.tgz     compressed realm (Windows; extracted on first sync use)
 *
 * Env overrides (Nix flake package):
 *   ROXYSU_RESOURCES  — packaged resource root without electron-builder asar
 *   ROXYSU_NODE_BIN   — Node binary for server/realm children (nixpkgs nodejs)
 *
 * Dev (monorepo): apps/desktop → repo root → apps/server, apps/realm-reader
 */

/**
 * @param {{ isPackaged: boolean, getAppPath: () => string, getPath: (name: string) => string }} app
 */
function resolveDesktopPaths(app) {
  const resourcesOverride = process.env.ROXYSU_RESOURCES?.trim() || null;
  const usePackagedLayout = Boolean(app.isPackaged) || Boolean(resourcesOverride);

  if (usePackagedLayout) {
    const resources = resourcesOverride || process.resourcesPath;
    const dataDir =
      process.env.ROXYSU_DATA_DIR?.trim() || app.getPath("userData");
    const serverDir = path.join(resources, "server");
    const nodeBinName = process.platform === "win32" ? "node.exe" : "node";
    const bundledNode = path.join(resources, "node", nodeBinName);
    const nodeBinEnv = process.env.ROXYSU_NODE_BIN?.trim() || null;
    const nodeBin =
      (nodeBinEnv && fs.existsSync(nodeBinEnv) && nodeBinEnv) ||
      (fs.existsSync(bundledNode) ? bundledNode : null);

    const unpackedRealmDir = path.join(resources, "realm-reader");
    const hasUnpackedRealm = fs.existsSync(
      path.join(unpackedRealmDir, "index.js"),
    );
    const realmArchive = path.join(resources, "realm-reader.tgz");
    // Prefer store-unpacked realm (Nix). Otherwise extract tarball into userData.
    const realmDir = hasUnpackedRealm
      ? unpackedRealmDir
      : path.join(dataDir, "runtime", "realm-reader");

    return {
      isPackaged: true,
      repoRoot: null,
      resourcesDir: resources,
      dataDir,
      dbPath: process.env.DB_PATH?.trim() || path.join(dataDir, "data.sqlite"),
      staticDir:
        process.env.ROXYSU_STATIC_DIR?.trim() ||
        path.join(resources, "public"),
      serverDir,
      serverEntry:
        process.env.ROXYSU_SERVER_ENTRY?.trim() ||
        path.join(resources, "server", "index.node.js"),
      migrationsFolder: path.join(serverDir, "drizzle"),
      nodeBin,
      realmArchive:
        hasUnpackedRealm || !fs.existsSync(realmArchive) ? null : realmArchive,
      realmDir,
      realmEntry:
        process.env.ROXYSU_REALM_ENTRY?.trim() ||
        path.join(realmDir, "index.js"),
      realmSchema:
        process.env.ROXYSU_REALM_SCHEMA?.trim() ||
        path.join(realmDir, "schemas", "osu-client.schema.json"),
    };
  }

  const desktopRoot = path.resolve(__dirname);
  const repoRoot = path.resolve(desktopRoot, "../..");
  const serverDir = path.join(repoRoot, "apps", "server");
  const realmDir = path.join(repoRoot, "apps", "realm-reader");
  const dataDir =
    process.env.ROXYSU_DATA_DIR?.trim() || app.getPath("userData");

  return {
    isPackaged: false,
    repoRoot,
    resourcesDir: desktopRoot,
    dataDir,
    dbPath: process.env.DB_PATH?.trim() || path.join(dataDir, "data.sqlite"),
    staticDir:
      process.env.ROXYSU_STATIC_DIR?.trim() ||
      path.join(serverDir, "dist", "public"),
    serverDir,
    serverEntry:
      process.env.ROXYSU_SERVER_ENTRY?.trim() ||
      path.join(serverDir, "src", "index.node.ts"),
    migrationsFolder: path.join(repoRoot, "packages", "db", "drizzle"),
    nodeBin: null,
    realmArchive: null,
    realmDir,
    realmEntry:
      process.env.ROXYSU_REALM_ENTRY?.trim() ||
      path.join(realmDir, "src", "index.ts"),
    realmSchema:
      process.env.ROXYSU_REALM_SCHEMA?.trim() ||
      path.join(realmDir, "schemas", "osu-client.schema.json"),
  };
}

/**
 * @param {string} filePath
 */
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Extract packaged realm-reader.tgz into userData on first use so the install
 * tree stays small for Defender (archive is one file vs ~GB of natives).
 * @param {{ realmArchive: string | null, realmDir: string, realmEntry: string }} paths
 */
function ensureRealmExtracted(paths) {
  if (!paths.realmArchive) {
    // Dev / unpacked layout already has realmDir.
    if (!fs.existsSync(paths.realmEntry) && !fs.existsSync(paths.realmDir)) {
      throw new Error(`realm-reader missing at ${paths.realmDir}`);
    }
    return;
  }

  const marker = path.join(paths.realmDir, ".roxysu-extracted");
  if (fs.existsSync(marker) && fs.existsSync(paths.realmEntry)) {
    return;
  }

  fs.mkdirSync(paths.realmDir, { recursive: true });
  // Windows 10+ and macOS/Linux ship a tar that understands gzip.
  execFileSync(
    "tar",
    ["-xzf", paths.realmArchive, "-C", paths.realmDir, "--strip-components=1"],
    { stdio: "inherit" },
  );
  // tarball root is "realm-reader/..." — if strip failed on some tar, flatten.
  const nested = path.join(paths.realmDir, "realm-reader", "index.js");
  if (!fs.existsSync(paths.realmEntry) && fs.existsSync(nested)) {
    // Move nested contents up.
    const nestedDir = path.join(paths.realmDir, "realm-reader");
    for (const name of fs.readdirSync(nestedDir)) {
      fs.renameSync(path.join(nestedDir, name), path.join(paths.realmDir, name));
    }
    fs.rmSync(nestedDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(paths.realmEntry)) {
    throw new Error(
      `realm extract did not produce ${paths.realmEntry} from ${paths.realmArchive}`,
    );
  }
  fs.writeFileSync(marker, new Date().toISOString(), "utf8");
}

module.exports = {
  resolveDesktopPaths,
  ensureParentDir,
  ensureRealmExtracted,
};
