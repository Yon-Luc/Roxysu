import packageJson from "../../package.json";

/** Product version from `apps/server/package.json`. */
export const APP_VERSION: string = packageJson.version;

/** Pre-release channel shown next to the version in the UI. */
export const APP_CHANNEL = "Alpha";

export function formatAppVersionLabel(
  version: string = APP_VERSION,
  channel: string = APP_CHANNEL,
): string {
  return `${channel} ${version}`;
}
