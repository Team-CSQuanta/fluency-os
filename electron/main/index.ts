import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { startBackend, stopBackend, type BackendHandle } from './backend-process';
import { isDownloadActive } from './download-state';
import { registerIpcHandlers } from './ipc-handlers';
import { logger } from './logger';

let backendHandle: BackendHandle | null = null;
let mainWindow: BrowserWindow | null = null;
// Set true only once the user has confirmed "close anyway" from the warning
// dialog below — lets the second, re-triggered close() actually go through
// instead of looping back into the same warning.
let allowClose = false;

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
  mainWindow.on('close', (event) => {
    if (allowClose || !isDownloadActive()) return;
    event.preventDefault();
    const win = mainWindow;
    if (!win) return;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Close Anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Download in progress',
        message: 'A model download is still in progress.',
        detail:
          "Closing FluencyOS now will interrupt it. There's no partial-file resume yet, so the download will need to restart from the beginning next time.",
      })
      .then((result) => {
        if (result.response === 1) {
          allowClose = true;
          win.close();
        }
      });
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
