// Preload for the main budgetr window. Exposes a small, explicit bridge so the
// web UI can tell it's running in the desktop app and drive the Plaid setup
// browser pane (see plaid-guide.js). Nothing else from Electron or Node is
// exposed, and the main process only honours these calls from budgetr's own
// local pages.

const { contextBridge, ipcRenderer, webFrame } = require("electron");

// The page measures in CSS pixels; the pane is placed in window pixels. They
// differ when the user zooms the app (⌘+ / ⌘−).
function toWindow(b) {
  const z = webFrame.getZoomFactor() || 1;
  return {
    x: Math.round((b?.x ?? 0) * z),
    y: Math.round((b?.y ?? 0) * z),
    width: Math.round((b?.width ?? 0) * z),
    height: Math.round((b?.height ?? 0) * z),
  };
}

function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("budgetrDesktop", {
  plaidGuide: {
    open: (url, bounds) => ipcRenderer.invoke("plaid-guide:open", { url, bounds: toWindow(bounds) }),
    setBounds: (bounds) => ipcRenderer.send("plaid-guide:bounds", toWindow(bounds)),
    navigate: (url) => ipcRenderer.invoke("plaid-guide:navigate", url),
    back: () => ipcRenderer.invoke("plaid-guide:command", "back"),
    forward: () => ipcRenderer.invoke("plaid-guide:command", "forward"),
    reload: () => ipcRenderer.invoke("plaid-guide:command", "reload"),
    focus: () => ipcRenderer.invoke("plaid-guide:command", "focus"),
    openInBrowser: (url) => ipcRenderer.invoke("plaid-guide:open-external", url),
    close: () => ipcRenderer.invoke("plaid-guide:close"),
    onState: (cb) => subscribe("plaid-guide:state", cb),
    onBlocked: (cb) => subscribe("plaid-guide:blocked", cb),
    onError: (cb) => subscribe("plaid-guide:error", cb),
  },
});
