import packageJson from "../package.json";

/** Product version from `apps/server/package.json` (same as UI `APP_VERSION`). */
export const APP_VERSION: string = packageJson.version;
