// Tracks whether the renderer currently has a real model download (LLM/STT/TTS)
// in progress, pushed over IPC from engineStore.ts. The main process needs
// this to decide whether to warn before letting the window actually close —
// it has no visibility into renderer state otherwise.
let active = false;

export function setDownloadActive(value: boolean): void {
  active = value;
}

export function isDownloadActive(): boolean {
  return active;
}
