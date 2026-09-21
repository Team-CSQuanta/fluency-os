import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { BackendHandle } from './backend-process';
import { setDownloadActive } from './download-state';
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

  ipcMain.handle('dialog:pick-book-files', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Books', extensions: ['epub', 'pdf', 'mobi', 'azw3', 'txt'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pick-media-files', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video',
          extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', 'ts'],
        },
      ],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pick-image-file', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pick-subtitle-file', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());

  ipcMain.on('downloads:set-active', (_event, active: boolean) => setDownloadActive(active));

  ipcMain.on('ui:set-scale', (_event, factor: number) => {
    // Clamped: Chromium will happily accept a factor that makes the app
    // unusable in either direction, and there is no way back from a window
    // whose controls have scrolled off screen.
    const clamped = Math.max(0.8, Math.min(1.6, Number(factor) || 1));
    getWindow()?.webContents.setZoomFactor(clamped);
  });
}
