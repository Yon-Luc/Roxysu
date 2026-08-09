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
});
