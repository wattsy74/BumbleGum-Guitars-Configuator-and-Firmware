// Preload script for BGG Configurator
// Since we're using nodeIntegration: true, we'll expose APIs through window object

const { ipcRenderer } = require('electron');

// Expose auto-updater APIs on the window object for compatibility
window.electronAPI = {
  // Auto-updater methods
  getCurrentVersion: () => ipcRenderer.invoke('get-current-version'),
  downloadUpdate: (updateInfo) => ipcRenderer.invoke('download-update', updateInfo),
  installUpdate: (downloadPath) => ipcRenderer.invoke('install-update', downloadPath),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  
  // Manual installation helpers
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  
  // Registry cleanup (existing)
  cleanupRegistry: (psScript) => ipcRenderer.invoke('cleanup-registry', psScript),

  // Listen for download progress
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', callback);
    return () => ipcRenderer.removeListener('download-progress', callback);
  }
};
