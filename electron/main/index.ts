import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { startBackend, stopBackend, type BackendHandle } from './backend-process';
import { isDownloadActive } from './download-state';
import { registerIpcHandlers } from './ipc-handlers';
import { logger } from './logger';

let backendHandle: BackendHandle | null = null;
let mainWindow: BrowserWindow | null = null;
// Set true only once the user has confirmed "close anyway" in the renderer's
// warning dialog — lets the second, re-triggered close() actually go through
// instead of looping back into the same warning.
let allowClose = false;

// The renderer draws that warning (so it looks like the rest of the app) and
// reports the answer back here, where the close is actually gated.
ipcMain.on('downloads:force-close', () => {
  allowClose = true;
  mainWindow?.close();
});

const isDev = !app.isPackaged;

function resolveIconPath(): string {
  // Dev: project root is the Electron app path. Packaged builds resolve their
  // own icon via electron-builder config, but this path also works unpacked.
  return path.join(app.getAppPath(), 'build/icon.png');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#131514',
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // A model download is real, in-progress network + disk work with no resume
  // support mid-file — closing while one is active silently loses that
  // progress, so it's worth an explicit warning rather than just quitting.
  // The warning is drawn by the renderer rather than as a native message box,
  // so it matches the rest of the app instead of arriving as an OS dialog.
  mainWindow.on('close', (event) => {
    if (allowClose || !isDownloadActive()) return;
    event.preventDefault();
    mainWindow?.webContents.send('downloads:confirm-close');
  });
}

registerIpcHandlers(
  () => backendHandle,
  () => mainWindow,
);

app.whenReady().then(async () => {
  try {
    backendHandle = await startBackend();
  } catch (err) {
    logger.error('failed to start backend', err);
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend(backendHandle);
  backendHandle = null;
});
