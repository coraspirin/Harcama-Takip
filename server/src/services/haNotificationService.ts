import { env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import { checkHaUrl, parseHaUrl, type AllowedHost } from '../lib/haUrl.ts';

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

/**
 * Adresi dogrular: http/https, kullanici adi/parola yok, HA_ALLOWED_HOSTS
 * doluysa izinli host. `allowed` yalnizca testlerde enjekte edilir.
 */
export function assertHaUrlAllowed(
  baseUrl: string,
  allowed: readonly AllowedHost[] = env.HA_ALLOWED_HOSTS,
): void {
  checkHaUrl(baseUrl, allowed);
}

function normalizeBaseUrl(baseUrl: string): string {
  parseHaUrl(baseUrl);
  return baseUrl.trim().replace(/\/+$/, '');
}

async function haFetch(
  baseUrl: string,
  token: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  // Her giden istekten once: liste sonradan daraltilirsa eski kayitlar da engellenir.
  assertHaUrlAllowed(baseUrl);
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
      // Yonlendirme izlenmez: token'in baska bir hosta (veya izin listesi disina)
      // gonderilmesini engeller.
      redirect: 'manual',
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

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError(502, 'HA_ERROR', 'Home Assistant yonlendirme dondu; dogrudan adresi girin.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      400,
      'HA_UNAUTHORIZED',
      "Home Assistant erisim token'i gecersiz veya suresi dolmus.",
    );
  }

  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new AppError(502, 'HA_ERROR', `Home Assistant hata dondu (${response.status}): ${body}`);
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
  let domains: {
    domain: string;
    services: Record<string, { name?: string; description?: string }>;
  }[];
  try {
    domains = (await response.json()) as typeof domains;
  } catch (err) {
    // V8 JSON mesaji yanit govdesinden parca icerir: mesaj katilmaz, cause verilir.
    throw new AppError(
      502,
      'HA_ERROR',
      'Home Assistant gecersiz bir yanit dondu (JSON okunamadi).',
      undefined,
      { cause: err },
    );
  }
  if (!Array.isArray(domains)) {
    throw new AppError(502, 'HA_ERROR', 'Home Assistant beklenmeyen bir yanit dondu.');
  }

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
