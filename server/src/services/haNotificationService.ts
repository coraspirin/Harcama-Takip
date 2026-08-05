import { AppError, badRequest } from '../lib/errors.ts';

/**
 * Home Assistant REST API istemcisi.
 *
 * ONEMLI: token hicbir kosulda loglanmaz. Hata mesajlarina yalnizca HTTP
 * durum kodu ve HA'nin dondugu metin girer; Authorization basligi asla.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export type HaService = {
  /** notify servisinin adi, or. "mobile_app_telefonum" */
  service: string;
  name: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badRequest('Home Assistant adresi gecerli bir URL olmali (or. http://192.168.1.10:8123)');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('Home Assistant adresi http:// veya https:// ile baslamali');
  }

  return trimmed;
}

async function haFetch(
  baseUrl: string,
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${normalizeBaseUrl(baseUrl)}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      // Yonlendirme izlenmez: token'in beklenmedik bir sunucuya gonderilmesini
      // engeller.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'bilinmeyen';
    throw new AppError(
      502,
      'HA_UNREACHABLE',
      reason === 'TimeoutError'
        ? 'Home Assistant zaman asimina ugradi. Adresi ve agi kontrol edin.'
        : 'Home Assistant sunucusuna ulasilamadi. Adresi kontrol edin.',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      400,
      'HA_UNAUTHORIZED',
      'Home Assistant erisim token\'i gecersiz veya suresi dolmus.',
    );
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new AppError(
      502,
      'HA_ERROR',
      `Home Assistant hata dondu (${response.status}): ${body}`,
    );
  }

  return response;
}

/**
 * Kullanilabilir notify hedeflerini listeler. Kullanicinin servis adini elle
 * yazmasi yerine listeden secmesi, en sik yapilan yazim hatasini ortadan
 * kaldirir.
 */
export async function fetchNotifyTargets(baseUrl: string, token: string): Promise<HaService[]> {
  const response = await haFetch(baseUrl, token, '/api/services');
  const domains = (await response.json()) as {
    domain: string;
    services: Record<string, { name?: string; description?: string }>;
  }[];

  const notify = domains.find((d) => d.domain === 'notify');
  if (!notify) return [];

  return Object.entries(notify.services)
    .map(([service, meta]) => ({ service, name: meta.name ?? service }))
    .sort((a, b) => a.service.localeCompare(b.service, 'tr'));
}

export async function sendNotification(
  baseUrl: string,
  token: string,
  target: string,
  title: string,
  message: string,
): Promise<void> {
  await haFetch(baseUrl, token, `/api/services/notify/${encodeURIComponent(target)}`, {
    method: 'POST',
    body: JSON.stringify({ title, message }),
  });
}

/** Baglantiyi dogrular ve hedeflerin listesini doner. */
export async function testConnection(baseUrl: string, token: string): Promise<HaService[]> {
  return fetchNotifyTargets(baseUrl, token);
}
