import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('fluencyos', {
  getBackendInfo: () => ipcRenderer.invoke('backend:get-info'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  pickDataFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  pickBookFiles: () => ipcRenderer.invoke('dialog:pick-book-files'),
  pickMediaFiles: () => ipcRenderer.invoke('dialog:pick-media-files'),
  pickSubtitleFile: () => ipcRenderer.invoke('dialog:pick-subtitle-file'),
  pickImageFile: () => ipcRenderer.invoke('dialog:pick-image-file'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  setDownloadActive: (active: boolean) => ipcRenderer.send('downloads:set-active', active),
  // Text size. Chromium's own zoom rather than a CSS variable: the interface
  // sizes several hundred elements in absolute px, so nothing short of
  // scaling the whole surface moves them together — and zoom scales layout,
  // borders and images with the type instead of leaving them behind.
  setUiScale: (factor: number) => ipcRenderer.send('ui:set-scale', factor),
  // Main defers the close and asks the renderer to draw the warning itself, so
  // it matches the app rather than arriving as a native OS message box.
  onConfirmClose: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('downloads:confirm-close', listener);
    return () => ipcRenderer.removeListener('downloads:confirm-close', listener);
  },
  forceClose: () => ipcRenderer.send('downloads:force-close'),
});
