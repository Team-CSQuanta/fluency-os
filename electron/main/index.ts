import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { startBackend, stopBackend, type BackendHandle } from './backend-process';
import { registerIpcHandlers } from './ipc-handlers';
import { logger } from './logger';

let backendHandle: BackendHandle | null = null;
let mainWindow: BrowserWindow | null = null;

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
