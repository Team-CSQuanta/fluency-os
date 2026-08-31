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
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
}

declare global {
  interface Window {
    fluencyos: FluencyOSBridge;
  }
}
