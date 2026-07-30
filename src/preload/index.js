const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('snapcut', {
  onCaptureReady: (listener) => subscribe('capture:ready', listener),
  onCaptureError: (listener) => subscribe('capture:error', listener),
  onSettingsChanged: (listener) => subscribe('settings:changed', listener),
  copyImage: (pngBytes) => ipcRenderer.invoke('capture:copy', pngBytes),
  saveImage: (pngBytes, suggestedName) =>
    ipcRenderer.invoke('capture:save', { pngBytes, suggestedName }),
  closeOverlay: () => ipcRenderer.invoke('capture:close'),
  captureLoaded: () => ipcRenderer.invoke('capture:loaded'),
  captureLoadFailed: (message) => ipcRenderer.invoke('capture:load-failed', message),
  startCapture: () => ipcRenderer.invoke('capture:start'),
  getAppContext: () => ipcRenderer.invoke('app:context'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  openScreenPermission: () => ipcRenderer.invoke('permission:open-screen-settings'),
  openReleases: () => ipcRenderer.invoke('shell:open-releases'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
  quit: () => ipcRenderer.invoke('app:quit'),
});
