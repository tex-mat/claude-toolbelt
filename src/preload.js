// Exposes a minimal, explicit API to the panel UI. The renderer never
// touches the filesystem or clipboard directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scan: () => ipcRenderer.invoke('scan'),
  setExpanded: (expanded) => ipcRenderer.invoke('set-expanded', expanded),
  copyPrompt: (invoke, args, extra) => ipcRenderer.invoke('copy-prompt', { invoke, args, extra }),
  readDoc: (filePath) => ipcRenderer.invoke('read-doc', filePath),
  onToggle: (callback) => ipcRenderer.on('toggle-panel', callback),
  quit: () => ipcRenderer.invoke('quit'),
});
