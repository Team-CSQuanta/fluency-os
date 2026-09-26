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

/** An HTTP failure with the status kept as a field rather than only spelled
 * into the message.
 *
 * Callers need to tell one failure from another — a 503 from the engines not
 * being launched wants a "start the AI" dialog, while a 400 wants the message
 * shown as-is. Until now the only way to know which was to pattern-match the
 * message string. Extends Error, so every existing `instanceof Error` and
 * `.message` read keeps working unchanged.
 */
export class ApiError extends Error {
  readonly status: number;
  /** FastAPI's `detail`, unwrapped from the JSON body when there is one. */
  readonly detail: string;

  constructor(method: string, path: string, status: number, body: string) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.detail === 'string') detail = parsed.detail;
    } catch {
      // Not JSON — keep the raw body, which is what the old message carried.
    }
    super(`API ${method} ${path} failed: ${status} ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
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
    throw new ApiError(init?.method ?? 'GET', path, res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// Binary GETs (covers, etc) can't go through request<T>()'s JSON parsing, but
// still need the X-FluencyOS-Token header — a plain <img src> can't attach
// custom headers, so callers fetch the blob and turn it into an object URL.
export async function fetchBlobUrl(path: string): Promise<string> {
  const { baseUrl, token } = requireBackendInfo();
  const res = await fetch(`${baseUrl}${path}`, { headers: { 'X-FluencyOS-Token': token } });
  if (!res.ok) {
    throw new ApiError('GET', path, res.status, '');
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// A URL the browser itself will fetch — a <video src>, a poster <img>.
// Those tags cannot carry a custom header, and the fetch-into-a-blob trick
// fetchBlobUrl uses would mean holding a whole film in renderer memory and
// losing seeking, so the handshake token rides as a query parameter instead.
// The backend accepts it only on these file routes (see security.py).
export function fileUrl(path: string): string {
  const { baseUrl, token } = requireBackendInfo();
  const separator = path.includes('?') ? '&' : '?';
  return `${baseUrl}${path}${separator}t=${encodeURIComponent(token)}`;
}

// Multipart uploads (conversation turn audio) can't go through request<T>()'s
// forced 'Content-Type: application/json' — the browser needs to set its own
// boundary — so this bypasses it the same way fetchBlobUrl bypasses the JSON
// response parsing.
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const { baseUrl, token } = requireBackendInfo();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'X-FluencyOS-Token': token },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError('POST', path, res.status, body);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  postForm,
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
