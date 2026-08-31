import os from 'node:os';

export interface SystemInfo {
  cpuCores: number;
  totalRamBytes: number;
  platform: string;
}

// Real hardware data only — no fabricated GPU/disk figures we can't actually observe.
export function getSystemInfo(): SystemInfo {
  return {
    cpuCores: os.cpus().length,
    totalRamBytes: os.totalmem(),
    platform: os.platform(),
  };
}
