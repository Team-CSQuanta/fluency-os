import os from 'node:os';
import { app } from 'electron';

export interface SystemInfo {
  cpuCores: number;
  totalRamBytes: number;
  platform: string;
  /** Where everything the app has written lives: the database, the clips, the
   * downloaded models, the page images. Settings promises to say where your
   * data sits, and only the main process knows. */
  dataFolder: string;
}

// Real hardware data only — no fabricated GPU/disk figures we can't actually observe.
export function getSystemInfo(): SystemInfo {
  return {
    cpuCores: os.cpus().length,
    totalRamBytes: os.totalmem(),
    platform: os.platform(),
    dataFolder: app.getPath('userData'),
  };
}
