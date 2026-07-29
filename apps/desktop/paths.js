const path = require("node:path");
const fs = require("node:fs");

/**
 * Resolve monorepo vs packaged Electron resource layouts.
 *
 * Packaged layout (electron-builder, future):
 *   resources/
 *     public/           built UI
 *     server/           Node server entry + deps
 *     realm-reader/     realm sync entry + schema JSON
 *
 * Dev (monorepo): apps/desktop → repo root → apps/server, apps/realm-reader
 */

/**
 * @param {{ isPackaged: boolean, getAppPath: () => string, getPath: (name: string) => string }} app
 */
function resolveDesktopPaths(app) {
  const isPackaged = Boolean(app.isPackaged);

  if (isPackaged) {
    const resources = process.resourcesPath;
    const dataDir =
      process.env.ROXYSU_DATA_DIR?.trim() || app.getPath("userData");
    return {
      isPackaged: true,
      repoRoot: null,
      dataDir,
      dbPath: process.env.DB_PATH?.trim() || path.join(dataDir, "data.sqlite"),
      staticDir:
        process.env.ROXYSU_STATIC_DIR?.trim() ||
        path.join(resources, "public"),
      serverDir: path.join(resources, "server"),
      serverEntry:
        process.env.ROXYSU_SERVER_ENTRY?.trim() ||
        path.join(resources, "server", "index.node.js"),
      realmDir: path.join(resources, "realm-reader"),
      realmEntry:
        process.env.ROXYSU_REALM_ENTRY?.trim() ||
        path.join(resources, "realm-reader", "index.js"),
      realmSchema:
        process.env.ROXYSU_REALM_SCHEMA?.trim() ||
        path.join(resources, "realm-reader", "schemas", "osu-client.schema.json"),
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
    dataDir,
    dbPath: process.env.DB_PATH?.trim() || path.join(dataDir, "data.sqlite"),
    staticDir:
      process.env.ROXYSU_STATIC_DIR?.trim() ||
      path.join(serverDir, "dist", "public"),
    serverDir,
    serverEntry:
      process.env.ROXYSU_SERVER_ENTRY?.trim() ||
      path.join(serverDir, "src", "index.node.ts"),
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

module.exports = { resolveDesktopPaths, ensureParentDir };
