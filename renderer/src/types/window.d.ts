export interface BackendInfo {
  baseUrl: string;
  token: string;
}

export interface SystemInfo {
  cpuCores: number;
  totalRamBytes: number;
  platform: string;
}

export interface FluencyOSBridge {
  getBackendInfo: () => Promise<BackendInfo>;
  getSystemInfo: () => Promise<SystemInfo>;
  pickDataFolder: () => Promise<string | null>;
  pickBookFiles: () => Promise<string[]>;
  getPathForFile: (file: File) => string;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  setDownloadActive: (active: boolean) => void;
  /** Chromium zoom factor, 0.8–1.6. Scales the whole interface, which is the
   * only thing that moves several hundred absolute-px sizes together. */
  setUiScale: (factor: number) => void;
  /** Registers the close-confirmation handler; returns an unsubscribe. */
  onConfirmClose: (handler: () => void) => () => void;
  forceClose: () => void;
}

declare global {
  interface Window {
    fluencyos: FluencyOSBridge;
  }
}
