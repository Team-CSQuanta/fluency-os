import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('fluencyos', {
  getBackendInfo: () => ipcRenderer.invoke('backend:get-info'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  pickDataFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  pickBookFiles: () => ipcRenderer.invoke('dialog:pick-book-files'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
});
