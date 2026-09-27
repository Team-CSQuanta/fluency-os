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
  /** The GPU Chromium is drawing with, by vendor — "amd", "nvidia", "intel",
   * "apple" — or null when there is only a software renderer. It is what
   * decides whether local models can run on a GPU (llama.cpp's Vulkan or
   * Metal build), so the onboarding recommendation can count on it. */
  gpuVendor: string | null;
}

// PCI vendor ids. Anything else — Microsoft's Basic Render Driver, Google's
// SwiftShader, a VM's virtual adapter — is not a GPU a model can run on.
const GPU_VENDORS: Record<number, string> = {
  0x10de: 'nvidia',
  0x1002: 'amd',
  0x1022: 'amd',
  0x8086: 'intel',
  0x106b: 'apple',
};

async function gpuVendor(): Promise<string | null> {
  // Apple silicon: the GPU is part of the chip, and Chromium may not report
  // a PCI vendor for it.
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'apple';
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Array<{ vendorId: number; active?: boolean }> };
    const devices = info.gpuDevice ?? [];
    // The active adapter first, then any real one (a laptop may be drawing
    // with the integrated GPU while a discrete one sits idle).
    const ordered = [...devices.filter((d) => d.active), ...devices.filter((d) => !d.active)];
    for (const device of ordered) {
      const vendor = GPU_VENDORS[device.vendorId];
      if (vendor) return vendor;
    }
  } catch {
    // Not knowing is the same as no GPU: the recommendation stays CPU-only.
  }
  return null;
}

// Real hardware data only — nothing we cannot actually observe.
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    cpuCores: os.cpus().length,
    totalRamBytes: os.totalmem(),
    platform: os.platform(),
    dataFolder: app.getPath('userData'),
    gpuVendor: await gpuVendor(),
  };
}
