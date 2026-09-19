import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { startBackend, stopBackend, type BackendHandle } from './backend-process';
import { registerSceneEmbedReferrer } from './scene-embeds';
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
    // DevTools on demand, not on every launch. Opening it automatically made
    // Chromium print two errors into the dev terminal on every start that
    // have nothing to do with this app — a DevTools-protocol "Autofill.enable
    // wasn't found" pair (Electron implements no Autofill domain) and a
    // "Cannot send request of length 16777248" from the DevTools IPC pipe's
    // 16 MiB per-message cap. Both are noise, and noise in a dev log is
    // expensive: it trains you to scroll past the region where real backend
    // errors appear.
    //
    // Deliberately not filtered out of the child's stderr instead — that
    // would hide whatever else Chromium has to say, including things worth
    // reading.
    await mainWindow.loadURL('http://127.0.0.1:5173');
    if (process.env.FLUENCYOS_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  if (isDev) {
    // The window is frameless, so there is no menu bar and none of the
    // default menu accelerators are reachable — DevTools has to be bound
    // here or losing the auto-open would mean losing DevTools entirely.
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const toggle =
        input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
      if (toggle) mainWindow?.webContents.toggleDevTools();
    });
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

/** Let the player decode H.265 (HEVC).
 *
 * Chromium ships no software HEVC decoder, so by default an HEVC file plays
 * its AAC audio while the picture never appears — videoWidth stays 0 and not a
 * single frame is decoded, with no error raised. Measured on this machine
 * (AMD Vega APU, hardware HEVC decode present):
 *
 *     default                        canPlayType = ""     0 frames
 *     with these three features      canPlayType = ...    52 frames in 2s
 *
 * Deliberately WITHOUT --ignore-gpu-blocklist, which was also tried: it made no
 * difference here, and overriding the blocklist invites driver crashes on the
 * configurations it exists to protect.
 *
 * This is hardware decode, so it only helps where the GPU can do it. A machine
 * without HEVC support still cannot play these files, and the player says so
 * rather than showing a frozen frame.
 *
 * Must be set before `whenReady`; Chromium reads its command line at startup.
 */
app.commandLine.appendSwitch(
  'enable-features',
  'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,PlatformHEVCDecoderSupport',
);

app.whenReady().then(async () => {
  // Must be registered before any window loads a scene embed.
  registerSceneEmbedReferrer();

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
