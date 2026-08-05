import type { ApiErrorBody } from '../types/index.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Sunucunun alan bazli dogrulama hatalarini forma dagitmak icin. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const item of this.details as { path?: string; message?: string }[]) {
      if (item.path && item.message && !out[item.path]) out[item.path] = item.message;
    }
    return out;
  }
}

/** Oturum tamamen dustugunde AuthContext'in haberdar olmasi icin. */
type SessionExpiredListener = () => void;
let onSessionExpired: SessionExpiredListener | null = null;

export function setSessionExpiredHandler(fn: SessionExpiredListener | null): void {
  onSessionExpired = fn;
}

/**
 * Ayni anda birden fazla istek 401 alirsa tek bir yenileme yapilir; digerleri
 * ayni sozu bekler. Aksi halde her istek ayri ayri yenileme tetikler ve
 * rotasyon zinciri kendi kendini iptal eder.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Bir sonraki 401 yeni bir deneme baslatabilsin
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

/** Yenileme denemesi yapilmayacak uclar - sonsuz donguyu engeller. */
function isAuthEndpoint(path: string): boolean {
  return (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/refresh') ||
    path.startsWith('/api/auth/logout') ||
    path.startsWith('/api/setup')
  );
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* JSON degil */
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? 'Sunucuya ulasilamadi',
    body?.error?.details,
  );
}

async function send<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulasilamadi. Baglantinizi kontrol edin.');
  }

  if (res.status === 401 && retry && !isAuthEndpoint(path)) {
    const refreshed = await refreshSession();
    if (refreshed) return send<T>(method, path, body, false);
    onSessionExpired?.();
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === '' ? null : JSON.parse(text)) as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown) => send<T>('DELETE', path, body),
};
