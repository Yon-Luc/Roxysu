const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roxysuDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Open http(s) URLs in the system browser (hub OAuth, external links). */
  openExternal: (url) => ipcRenderer.invoke("roxysu:open-external", url),
  /** Write PNG (or other image) bytes to the system clipboard. */
  writeClipboardImage: (pngBytes) =>
    ipcRenderer.invoke("roxysu:write-clipboard-image", pngBytes),
  /**
   * DD-6: local server state pushed by the shell ({ state: "restarting",
   * attempt, maxAttempts, delayMs } or { state: "up" }). Returns unsubscribe.
   */
  onServerState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("roxysu:server-state", listener);
    return () => ipcRenderer.removeListener("roxysu:server-state", listener);
  },
});
