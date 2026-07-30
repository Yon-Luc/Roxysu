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
    const serverDir = path.join(resources, "server");
    return {
      isPackaged: true,
      repoRoot: null,
      dataDir,
      dbPath: process.env.DB_PATH?.trim() || path.join(dataDir, "data.sqlite"),
      staticDir:
        process.env.ROXYSU_STATIC_DIR?.trim() ||
        path.join(resources, "public"),
      serverDir,
      serverEntry:
        process.env.ROXYSU_SERVER_ENTRY?.trim() ||
        path.join(resources, "server", "index.node.js"),
      // Packaged: migrations are copied next to the server bundle (see build-pack.mjs).
      migrationsFolder: path.join(serverDir, "drizzle"),
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
    // Dev: migrations live in the db package, not under apps/server.
    migrationsFolder: path.join(repoRoot, "packages", "db", "drizzle"),
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
