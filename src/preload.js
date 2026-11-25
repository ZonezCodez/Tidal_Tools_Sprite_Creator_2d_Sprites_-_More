const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spriteDesktop', {
  isDesktop: true,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (data, defaultName) => ipcRenderer.invoke('project:save', { data, defaultName }),
  saveBytes: (base64, defaultName, filters, title) => ipcRenderer.invoke('file:save-bytes', {
    base64, defaultName, filters, title
  }),
  saveBundle: (files, defaultName, title) => ipcRenderer.invoke('file:save-bundle', {
    files, defaultName, title
  }),
  showInFolder: (filePath) => ipcRenderer.invoke('app:show-in-folder', filePath),
  requestClose: () => ipcRenderer.invoke('app:request-close'),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  completeExit: () => ipcRenderer.invoke('app:complete-close'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onExitRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:begin-exit', handler);
    return () => ipcRenderer.removeListener('app:begin-exit', handler);
  }
});
