/** Electron shell marker from `apps/desktop/preload.js`. */
export type RoxysuDesktopBridge = {
  platform: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  /** Open an http(s) URL in the system default browser. */
  openExternal?: (url: string) => Promise<void>;
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
