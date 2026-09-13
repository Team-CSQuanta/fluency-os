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
  setDownloadActive: (active: boolean) => ipcRenderer.send('downloads:set-active', active),
  // Main defers the close and asks the renderer to draw the warning itself, so
  // it matches the app rather than arriving as a native OS message box.
  onConfirmClose: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('downloads:confirm-close', listener);
    return () => ipcRenderer.removeListener('downloads:confirm-close', listener);
  },
  forceClose: () => ipcRenderer.send('downloads:force-close'),
});
