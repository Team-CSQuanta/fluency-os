import type { BackendInfo } from '@/types/window';

let backendInfo: BackendInfo | null = null;

export async function initApiClient(): Promise<BackendInfo> {
  backendInfo = await window.fluencyos.getBackendInfo();
  return backendInfo;
}

function requireBackendInfo(): BackendInfo {
  if (!backendInfo) {
    throw new Error('API client used before initApiClient() resolved');
  }
  return backendInfo;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, token } = requireBackendInfo();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-FluencyOS-Token': token,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
};
