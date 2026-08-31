import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { BackendHandle } from './backend-process';
import { getSystemInfo } from './system-info';

export function registerIpcHandlers(
  getBackend: () => BackendHandle | null,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle('backend:get-info', () => {
    const backend = getBackend();
    if (!backend) {
      throw new Error('Backend is not ready yet');
    }
    return { baseUrl: backend.baseUrl, token: backend.token };
  });

  ipcMain.handle('system:get-info', () => getSystemInfo());

  ipcMain.handle('dialog:pick-folder', async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());
}
