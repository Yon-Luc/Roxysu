/** Electron shell marker from `apps/desktop/preload.js`. */
export type RoxysuDesktopBridge = {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
};

declare global {
  interface Window {
    roxysuDesktop?: RoxysuDesktopBridge;
  }
}

/** True when the React UI is running inside the Electron product shell. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && window.roxysuDesktop != null;
}
