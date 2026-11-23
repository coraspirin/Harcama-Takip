import { AppError, badRequest } from './errors.ts';

/**
 * Home Assistant adresi dogrulama ve izinli host listesi (HA_ALLOWED_HOSTS).
 * Bu modul env'e bagimli DEGILDIR (env.ts bunu import eder); liste parametre
 * olarak gelir.
 */

export type AllowedHost = {
  /** Kucuk harf, punycode; IPv6 icin koseli parantezsiz. Joker ise "*." olmadan. */
  host: string;
  /** null: her port */
  port: number | null;
  /** true: yalniz alt alan adlari (example.com'un kendisi kapsanmaz) */
  wildcard: boolean;
};

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** Tek bir liste girdisini ayristirir; gecersizse Error firlatir. */
export function parseAllowedHostEntry(rawEntry: string): AllowedHost {
  const entry = rawEntry.trim().toLowerCase();
  if (entry === '') throw new Error('bos girdi');
  if (/\s/.test(entry) || /[/\\@?#]/.test(entry)) {
    throw new Error(`"${rawEntry}" yalniz host[:port] icermeli (sema, yol, bosluk olmaz)`);
  }

  let wildcard = false;
  let rest = entry;
  if (rest.startsWith('*.')) {
    wildcard = true;
    rest = rest.slice(2);
  }
  if (rest.includes('*')) {
    throw new Error(`"${rawEntry}": joker yalnizca basta "*." seklinde desteklenir`);
  }

  let hostPart: string;
  let portPart: string | undefined;
  if (rest.startsWith('[')) {
    const m = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/.exec(rest);
    if (!m) throw new Error(`"${rawEntry}" gecerli bir IPv6 girdisi degil`);
    hostPart = `[${m[1]}]`;
    portPart = m[2];
    if (wildcard) throw new Error(`"${rawEntry}": IPv6 icin joker kullanilamaz`);
  } else {
    const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(rest);
    if (!m?.[1] || !/^[\p{L}\p{N}._-]+$/u.test(m[1])) {
      throw new Error(`"${rawEntry}" gecerli bir host degil`);
    }
    hostPart = m[1];
    portPart = m[2];
  }

  let hostname: string;
  try {
    hostname = stripBrackets(new URL(`http://${hostPart}`).hostname);
  } catch {
    throw new Error(`"${rawEntry}" gecerli bir host degil`);
  }
  if (hostname === '') throw new Error(`"${rawEntry}" gecerli bir host degil`);

  let port: number | null = null;
  if (portPart !== undefined) {
    port = Number(portPart);
    if (port < 1 || port > 65535) throw new Error(`"${rawEntry}": port 1-65535 olmali`);
  }

  return { host: hostname, port, wildcard };
}

/** Virgulle ayrilmis listeyi ayristirir. Bos/tanimsiz -> [] (kisitlama yok). */
export function parseAllowedHosts(value: string | undefined): AllowedHost[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(parseAllowedHostEntry);
}

/** Adresi ayristirir (yalniz http/https); gecersizse 400 firlatir. */
export function parseHaUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw badRequest('Home Assistant adresi gecerli bir URL olmali (or. http://192.168.1.10:8123)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('Home Assistant adresi http:// veya https:// ile baslamali');
  }
  return parsed;
}

function hostMatches(allowed: AllowedHost, hostname: string, port: number): boolean {
  if (allowed.port !== null && allowed.port !== port) return false;
  if (allowed.wildcard) return hostname.endsWith(`.${allowed.host}`);
  return hostname === allowed.host;
}

/**
 * Adres http/https olmali, kullanici adi/parola icermemeli (liste bos olsa da)
 * ve liste doluysa host(+port) listeyle eslesmelidir.
 */
export function checkHaUrl(baseUrl: string, allowed: readonly AllowedHost[]): void {
  const parsed = parseHaUrl(baseUrl);

  if (parsed.username !== '' || parsed.password !== '') {
    throw badRequest('Home Assistant adresi kullanici adi veya parola icermemeli');
  }

  if (allowed.length === 0) return;

  const hostname = stripBrackets(parsed.hostname).toLowerCase();
  const port = parsed.port !== '' ? Number(parsed.port) : (DEFAULT_PORTS[parsed.protocol] ?? 0);

  if (!allowed.some((a) => hostMatches(a, hostname, port))) {
    throw new AppError(
      400,
      'HA_HOST_NOT_ALLOWED',
      'Bu Home Assistant adresine izin verilmiyor. Sunucu yöneticisi HA_ALLOWED_HOSTS ayarını güncellemeli.',
    );
  }
}
