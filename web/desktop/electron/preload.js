// Preload bridge for the packaged desktop shell.
// Exposes a narrow API to the renderer so the Windows first-run privacy gate
// can open the data folder, persist completion, and quit — without nodeIntegration.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("budgetrDesktop", {
  platform: process.platform,
  getUserDataPath: () => ipcRenderer.invoke("desktop:get-user-data-path"),
  openDataFolder: () => ipcRenderer.invoke("desktop:open-data-folder"),
  completePrivacyGate: () => ipcRenderer.invoke("desktop:complete-privacy-gate"),
  quitApp: () => ipcRenderer.invoke("desktop:quit"),
});
